import {
  PhysicalRoomScanManifest,
  SceneGraphState,
  SpatialEntityInstance,
  SpatialValidationResult,
  Vector3D
} from '../types/spatial';
import { SpatialMath } from './math';

export class SpatialGuardrailsEngine {
  static validateEntityPlacement(
    tentativeEntity: SpatialEntityInstance,
    scan: PhysicalRoomScanManifest,
    scene: SceneGraphState,
    targetWallId?: string
  ): SpatialValidationResult {
    const candidateOBB = SpatialMath.buildOBB(
      tentativeEntity.transform,
      tentativeEntity.boundingBox,
      0
    );
    const candidateClearanceOBB = SpatialMath.buildOBB(
      tentativeEntity.transform,
      tentativeEntity.boundingBox,
      tentativeEntity.clearanceBufferMeters
    );

    const bounds = scan.bounds;
    const minExt = bounds.min;
    const maxExt = bounds.max;
    const pos = tentativeEntity.transform.position;

    if (
      pos[0] < minExt[0] || pos[0] > maxExt[0] ||
      pos[2] < minExt[2] || pos[2] > maxExt[2]
    ) {
      return {
        valid: false,
        code: 'OUT_OF_BOUNDS',
        message: `Position [${pos.map(n => n.toFixed(2)).join(', ')}] violates room boundary limits. Room dimensions: X[${minExt[0]}m to ${maxExt[0]}m], Z[${minExt[2]}m to ${maxExt[2]}m].`,
        suggestedCorrection: {
          position: [
            Math.max(minExt[0] + 0.5, Math.min(maxExt[0] - 0.5, pos[0])),
            pos[1],
            Math.max(minExt[2] + 0.5, Math.min(maxExt[2] - 0.5, pos[2]))
          ]
        }
      };
    }

    if (!tentativeEntity.isWallMounted) {
      if (Math.abs(pos[1]) > 0.05) {
        return {
          valid: false,
          code: 'UNSUPPORTED_PLANE',
          message: `Floor-based furniture must be anchored at Y = 0.00m (provided Y = ${pos[1].toFixed(3)}m).`,
          suggestedCorrection: {
            position: [pos[0], 0.0, pos[2]]
          }
        };
      }
    }

    if (targetWallId) {
      const wallPlane = scan.planes.find(p => p.id === targetWallId && p.semanticType === 'wall');
      if (!wallPlane) {
        return {
          valid: false,
          code: 'UNSUPPORTED_PLANE',
          message: `Specified target wall ID '${targetWallId}' does not exist or is not categorized as a structural wall.`
        };
      }

      const wallPos = wallPlane.transform.position;
      const wallNormal: Vector3D = wallPlane.normal || SpatialMath.normalize([
        -wallPos[0],
        0,
        -wallPos[2]
      ]);

      const rotMat = SpatialMath.quaternionToRotationMatrix(tentativeEntity.transform.rotation);
      const forwardVec = SpatialMath.transformVectorByMatrix(rotMat, [0, 0, 1]);
      const alignmentDot = SpatialMath.dot(forwardVec, wallNormal);

      if (alignmentDot < 0.2) {
        const targetAngleDeg = (Math.atan2(wallNormal[0], wallNormal[2]) * 180) / Math.PI;
        return {
          valid: false,
          code: 'ORIENTATION_MISMATCH',
          message: `Object must face into the room away from wall plane '${targetWallId}'.`,
          suggestedCorrection: {
            rotation: SpatialMath.quaternionFromEulerY(targetAngleDeg)
          }
        };
      }
    }

    for (const plane of scan.planes) {
      if (plane.semanticType === 'door' || plane.semanticType === 'window') {
        const apertureOBB = SpatialMath.buildOBB(plane.transform, {
          min: [-plane.dimensions[0] / 2, -plane.dimensions[1] / 2, -0.4],
          max: [plane.dimensions[0] / 2, plane.dimensions[1] / 2, 0.4],
          center: [0, 0, 0],
          extents: [plane.dimensions[0] / 2, plane.dimensions[1] / 2, 0.4]
        }, 0.3);

        if (SpatialMath.testOBBOBBOverlap(candidateOBB, apertureOBB)) {
          return {
            valid: false,
            code: 'CLEARANCE_VIOLATION',
            message: `Entity obstructs opening anchor ${plane.semanticType} '${plane.id}'. Maintain a minimum egress clearance.`
          };
        }
      }
    }

    for (const existing of scene.entities) {
      if (existing.instanceId === tentativeEntity.instanceId) continue;

      const existingOBB = SpatialMath.buildOBB(
        existing.transform,
        existing.boundingBox,
        0
      );

      if (SpatialMath.testOBBOBBOverlap(candidateOBB, existingOBB)) {
        return {
          valid: false,
          code: 'COLLISION_DETECTED',
          culpritEntityId: existing.instanceId,
          message: `Physical geometry collides with existing entity '${existing.name}' (${existing.instanceId}).`
        };
      }

      const existingClearanceOBB = SpatialMath.buildOBB(
        existing.transform,
        existing.boundingBox,
        existing.clearanceBufferMeters
      );

      if (SpatialMath.testOBBOBBOverlap(candidateClearanceOBB, existingClearanceOBB)) {
        return {
          valid: false,
          code: 'CLEARANCE_VIOLATION',
          culpritEntityId: existing.instanceId,
          message: `Encroaches upon the traffic/clearance zone of '${existing.name}' (${existing.instanceId}).`
        };
      }
    }

    return { valid: true, code: 'OK', message: 'Placement satisfies all physical spatial guardrails.' };
  }
}
