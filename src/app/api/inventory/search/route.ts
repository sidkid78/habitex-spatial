import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { createClientFromRequest } from '../../../../lib/supabase/server';
import { resolveActor } from '../../../../lib/supabase/dev-auth';
import type { CatalogCategory } from '../../../../types/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SearchRequestPayload {
  query: string;
  category?: CatalogCategory;
  maxDimensionsMetric?: [width: number, height: number, depth: number];
  maxPriceCents?: number;
  matchThreshold?: number;
  limit?: number;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest();
    // Falls back to a seeded user in development only — see
    // lib/supabase/dev-auth. In production this is exactly
    // auth.getUser() and nothing else.
    const actor = await resolveActor(supabase);
    
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = (await req.json()) as SearchRequestPayload;
    const {
      query,
      category,
      maxDimensionsMetric,
      maxPriceCents,
      matchThreshold = 0.4,
      limit = 8,
    } = payload;

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'A text search query is required.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Embedding configuration is missing.' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });
    const embeddingResponse = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: query,
    });

    const rawResult = embeddingResponse as unknown as {
      embeddings?: Array<{ values: number[] }>;
      embedding?: { values: number[] };
    };
    const embeddingValues = rawResult.embeddings?.[0]?.values || rawResult.embedding?.values;
    
    if (!embeddingValues || embeddingValues.length === 0) {
      return NextResponse.json({ error: 'Failed to generate embedding for query' }, { status: 500 });
    }

    const queryEmbeddingStr = `[${embeddingValues.join(',')}]`;
    const maxDimStr = maxDimensionsMetric ? `[${maxDimensionsMetric.join(',')}]` : null;

    const { data: matchedItemsRaw, error: rpcError } = await actor.db.rpc('match_spatial_catalog_items', {
      query_embedding: queryEmbeddingStr,
      match_threshold: matchThreshold,
      match_count: limit,
      filter_category: category || null,
      max_price_cents: maxPriceCents || null,
      max_dimensions: maxDimStr,
    });

    if (rpcError) {
      console.error('[Inventory Vector Search RPC Failed]:', rpcError);
      return NextResponse.json({ error: 'Catalog match execution error', details: rpcError.message }, { status: 500 });
    }

    type RpcReturnType = Array<{
      id: string; sku: string; name: string; description: string; category: CatalogCategory;
      dimensions_metric: string | number[]; gltf_storage_path: string | null; usdz_storage_path: string | null;
      price_cents: number; currency: string; retailer_name: string; similarity: number;
    }>;
    const matchedItems = matchedItemsRaw as unknown as RpcReturnType | null;

    const formattedResults = (matchedItems || []).map((item) => {
      const dimensions = typeof item.dimensions_metric === 'string'
        ? JSON.parse(item.dimensions_metric)
        : item.dimensions_metric;

      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        description: item.description,
        category: item.category,
        dimensionsMetric: dimensions,
        pricing: {
          priceCents: item.price_cents,
          currency: item.currency,
          formattedPrice: `$${(item.price_cents / 100).toFixed(2)}`,
        },
        assets: {
          gltfUrl: item.gltf_storage_path,
          usdzUrl: item.usdz_storage_path,
        },
        retailerName: item.retailer_name,
        similarityScore: item.similarity,
      };
    });

    return NextResponse.json({
      success: true,
      query,
      count: formattedResults.length,
      items: formattedResults,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('[Inventory Search Fatal]:', error);
    return NextResponse.json({ error: 'Internal server error during search', details: error.message }, { status: 500 });
  }
}
