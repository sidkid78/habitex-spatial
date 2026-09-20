/**
 * Entry point. Replaced by the MCP server initialisation ticket.
 */
export const PLACEHOLDER = true;

export interface SpatialWorkspaceConfig {
  name: string;
  version: string;
  isReady: boolean;
  capabilities: {
    webXR: boolean;
    visionOS: boolean;
    agentStreaming: boolean;
  };
}

export function getSpatialWorkspaceConfig(): SpatialWorkspaceConfig {
  return {
    name: 'Habitex Spatial Studio',
    version: '0.1.0',
    isReady: PLACEHOLDER,
    capabilities: {
      webXR: true,
      visionOS: true,
      agentStreaming: true,
    },
  };
}
