import { NextRequest, NextResponse } from 'next/server';
import { createClientFromRequest, createAdminClient } from '../../../../lib/supabase/server';
import type { Database, Json } from '../../../../types/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckoutItemRequest {
  sku: string;
  quantity: number;
  sceneEntityId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized', message: 'Sign in to execute checkout.' }, { status: 401 });
    }

    const payloadRaw = await req.json();
    const rawRecord = payloadRaw as Record<string, unknown>;
    
    const sessionId = rawRecord.sessionId as string | undefined;
    const items = Array.isArray(rawRecord.items) ? (rawRecord.items as CheckoutItemRequest[]) : [];
    const shippingAddress = rawRecord.shippingAddress as Record<string, unknown> | undefined;

    if (items.length === 0) {
      return NextResponse.json({ error: 'Checkout requires at least one valid item.' }, { status: 400 });
    }

    if (!shippingAddress || typeof shippingAddress.street !== 'string' || typeof shippingAddress.postalCode !== 'string') {
      return NextResponse.json({ error: 'Incomplete shipping destination address provided.' }, { status: 422 });
    }

    const adminClient = createAdminClient();
    const skus = items.map((i) => i.sku);

    const { data: catalogRecordsRaw, error: catalogError } = await adminClient
      .from('spatial_catalog_items')
      .select('*')
      .in('sku', skus);
      
    const catalogRecords = catalogRecordsRaw as Array<Database['public']['Tables']['spatial_catalog_items']['Row']> | null;

    if (catalogError || !catalogRecords || catalogRecords.length === 0) {
      return NextResponse.json({ error: 'Items could not be resolved in live catalog.' }, { status: 404 });
    }

    let totalAmountCents = 0;
    const validatedOrderItems: Array<{
      catalog_item_id: string;
      scene_entity_id: string | null;
      unit_price_cents: number;
      quantity: number;
      retailer_id: string;
    }> = [];

    for (const requestedItem of items) {
      const catalogMatch = catalogRecords.find((c) => c.sku === requestedItem.sku);

      if (!catalogMatch) {
        return NextResponse.json({ error: `Item with SKU ${requestedItem.sku} does not exist.` }, { status: 404 });
      }

      if (!catalogMatch.in_stock || catalogMatch.stock_quantity < requestedItem.quantity) {
        return NextResponse.json(
          {
            error: 'Inventory depletion detected',
            message: `SKU '${catalogMatch.sku}' (${catalogMatch.name}) is out of stock or requested quantity exceeds available volume.`,
          },
          { status: 409 }
        );
      }

      const itemTotal = catalogMatch.price_cents * requestedItem.quantity;
      totalAmountCents += itemTotal;

      validatedOrderItems.push({
        catalog_item_id: catalogMatch.id,
        scene_entity_id: requestedItem.sceneEntityId || null,
        unit_price_cents: catalogMatch.price_cents,
        quantity: requestedItem.quantity,
        retailer_id: catalogMatch.retailer_id,
      });
    }

    const simulatedPaymentIntentId = `pi_habitex_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const { data: orderRaw, error: orderInsertError } = await supabase
      .from('orders')
      .insert({
        user_id: user.id,
        session_id: sessionId || null,
        status: 'pending_payment',
        total_amount_cents: totalAmountCents,
        currency: 'USD',
        shipping_address: shippingAddress as unknown as Json,
        billing_address: shippingAddress as unknown as Json,
        payment_intent_id: simulatedPaymentIntentId,
      } as unknown as never)
      .select()
      .single();
      
    const order = orderRaw as unknown as Database['public']['Tables']['orders']['Row'] | null;

    if (orderInsertError || !order) {
      console.error('[Checkout Order Insert Failed]:', orderInsertError);
      return NextResponse.json({ error: 'Order record creation failed.' }, { status: 500 });
    }

    const lineItemRows = validatedOrderItems.map((li) => ({
      order_id: order.id,
      ...li,
    }));

    const { error: lineItemsError } = await supabase.from('order_items').insert(lineItemRows as unknown as never);

    if (lineItemsError) {
      console.error('[Checkout Line Item Insertion Error]:', lineItemsError);
      return NextResponse.json({ error: 'Order created but line items failed to bind.' }, { status: 500 });
    }

    for (const item of items) {
      const match = catalogRecords.find((c) => c.sku === item.sku);
      if (match) {
        await adminClient
          .from('spatial_catalog_items')
          .update({
            stock_quantity: Math.max(0, match.stock_quantity - item.quantity),
            in_stock: match.stock_quantity - item.quantity > 0,
          } as unknown as never)
          .eq('id', match.id);
      }
    }

    return NextResponse.json(
      {
        success: true,
        orderId: order.id,
        status: order.status,
        totalAmountCents: order.total_amount_cents,
        formattedTotal: `$${(order.total_amount_cents / 100).toFixed(2)} USD`,
        paymentIntentClientSecret: `${simulatedPaymentIntentId}_secret_sample`,
        itemCount: validatedOrderItems.length,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const error = err as Error;
    console.error('[Checkout Route Fatal]:', error);
    return NextResponse.json({ error: 'Unexpected error during transaction staging', details: error.message }, { status: 500 });
  }
}
