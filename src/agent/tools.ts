import { FunctionDeclaration, Type } from '@google/genai';

export const placeModelTool: FunctionDeclaration = {
  name: 'place_model',
  description: 'Instantiates and places a 3D furniture item from the catalog into the room at specific metric coordinates [X, Y, Z] with yaw rotation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      sku: {
        type: Type.STRING,
        description: 'The unique retailer SKU code of the product to place.'
      },
      position: {
        type: Type.ARRAY,
        description: 'Metric world coordinates [X, Y, Z]. For floor objects, Y must be 0.00.',
        items: { type: Type.NUMBER }
      },
      rotationDegreesY: {
        type: Type.NUMBER,
        description: 'Yaw rotation around the vertical Y-axis in degrees (0 to 360).'
      },
      targetWallId: {
        type: Type.STRING,
        description: 'Optional ID of a wall plane anchor if aligning or mounting against a specific wall.'
      },
      clearanceBufferMeters: {
        type: Type.NUMBER,
        description: 'Required clearance buffer radius in metres (default: 0.40m).'
      }
    },
    required: ['sku', 'position', 'rotationDegreesY']
  }
};

export const transformObjectTool: FunctionDeclaration = {
  name: 'transform_object',
  description: 'Mutates the transform (translation, rotation, or uniform scale) of an existing entity in the scene.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      instanceId: {
        type: Type.STRING,
        description: 'The instance UUID of the placed object in the scene.'
      },
      newPosition: {
        type: Type.ARRAY,
        items: { type: Type.NUMBER },
        description: 'New metric [X, Y, Z] coordinates.'
      },
      newRotationDegreesY: {
        type: Type.NUMBER,
        description: 'New yaw rotation about vertical axis in degrees (0 to 360).'
      },
      scaleMultiplier: {
        type: Type.NUMBER,
        description: 'Uniform scale factor (e.g. 1.0 = default).'
      }
    },
    required: ['instanceId']
  }
};

export const deleteObjectTool: FunctionDeclaration = {
  name: 'delete_object',
  description: 'Removes an existing entity completely from the spatial scene graph.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      instanceId: {
        type: Type.STRING,
        description: 'The unique instance ID of the entity to remove.'
      }
    },
    required: ['instanceId']
  }
};

export const adjustLightingTool: FunctionDeclaration = {
  name: 'adjust_lighting',
  description: 'Modulates the ambient and directional lighting environment in the spatial scene to balance natural illumination.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      ambientLightColorHex: {
        type: Type.STRING,
        description: 'Hex color representation for ambient fill (e.g., "#FFF4E6").'
      },
      ambientIntensityLumens: {
        type: Type.NUMBER,
        description: 'Target ambient illumination level in lumens (typically 200 - 1500).'
      },
      directionalRigs: {
        type: Type.ARRAY,
        description: 'Directional lights simulating key light or window sunlight shafts.',
        items: {
          type: Type.OBJECT,
          properties: {
            direction: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER },
              description: 'Direction vector [dx, dy, dz].'
            },
            intensityLux: {
              type: Type.NUMBER,
              description: 'Light intensity in Lux.'
            },
            castShadows: {
              type: Type.BOOLEAN,
              description: 'Whether this light source casts real-time volumetric shadows.'
            }
          },
          required: ['direction', 'intensityLux', 'castShadows']
        }
      }
    },
    required: ['ambientLightColorHex', 'ambientIntensityLumens']
  }
};

export const setSurfaceMaterialTool: FunctionDeclaration = {
  name: 'set_surface_material',
  description: 'Applies physically based rendering (PBR) finishes (paint, wood, stone) to structural planes (walls or floors).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      planeAnchorId: {
        type: Type.STRING,
        description: 'ID of the structural plane anchor (from the scan manifest).'
      },
      materialCategory: {
        type: Type.STRING,
        description: 'Classification e.g., "limewash_paint", "white_oak", "calacatta_marble", "concrete".'
      },
      albedoHex: {
        type: Type.STRING,
        description: 'Base color hex (e.g. "#F2EFE9").'
      },
      roughness: {
        type: Type.NUMBER,
        description: 'Microfacet roughness coefficient between 0.0 (mirror) and 1.0 (completely diffuse).'
      },
      metallic: {
        type: Type.NUMBER,
        description: 'Metallic reflection factor between 0.0 (dielectric) and 1.0 (pure metal).'
      }
    },
    required: ['planeAnchorId', 'materialCategory', 'albedoHex', 'roughness', 'metallic']
  }
};

export const searchInventoryTool: FunctionDeclaration = {
  name: 'search_inventory',
  description: 'Searches live furniture catalog with spatial bounds and semantic design criteria.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Natural language description of the furniture piece (style, tone, material).'
      },
      category: {
        type: Type.STRING,
        description: 'Furniture category (e.g., "sofa", "coffee_table", "lounge_chair", "credenza").'
      },
      maxDimensions: {
        type: Type.ARRAY,
        items: { type: Type.NUMBER },
        description: 'Maximum permissible [width, height, depth] envelope in metres.'
      },
      maxBudgetUsd: {
        type: Type.NUMBER,
        description: 'Upper price bound in USD.'
      }
    },
    required: ['query']
  }
};

export const comparePricesTool: FunctionDeclaration = {
  name: 'compare_prices',
  description: 'Compares real-time retailer pricing, stock, and shipping lead times for a given SKU or across alternative vendors.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      sku: {
        type: Type.STRING,
        description: 'The master SKU identifier.'
      },
      includeAlternatives: {
        type: Type.BOOLEAN,
        description: 'Whether to return comparable pieces within +/- 15% dimensional tolerance.'
      }
    },
    required: ['sku']
  }
};

export const stagePurchaseTool: FunctionDeclaration = {
  name: 'stage_purchase',
  description: 'Stages selected scene items into a verified cart for checkout, reserving inventory allocations.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      items: {
        type: Type.ARRAY,
        description: 'List of items to stage for purchase.',
        items: {
          type: Type.OBJECT,
          properties: {
            sku: { type: Type.STRING },
            quantity: { type: Type.INTEGER },
            instanceId: { type: Type.STRING }
          },
          required: ['sku', 'quantity']
        }
      }
    },
    required: ['items']
  }
};

export const habitexTools: FunctionDeclaration[] = [
  placeModelTool,
  transformObjectTool,
  deleteObjectTool,
  adjustLightingTool,
  setSurfaceMaterialTool,
  searchInventoryTool,
  comparePricesTool,
  stagePurchaseTool
];
