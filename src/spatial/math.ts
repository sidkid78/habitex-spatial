import { Vector3D, Quaternion, Matrix3x3, OrientedBoundingBox, Transform3D, BoundingBox3D } from '../types/spatial';

export class SpatialMath {
  static add(a: Vector3D, b: Vector3D): Vector3D {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }

  static subtract(a: Vector3D, b: Vector3D): Vector3D {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  static scale(v: Vector3D, s: number): Vector3D {
    return [v[0] * s, v[1] * s, v[2] * s];
  }

  static dot(a: Vector3D, b: Vector3D): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  static cross(a: Vector3D, b: Vector3D): Vector3D {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  static magnitude(v: Vector3D): number {
    return Math.sqrt(this.dot(v, v));
  }

  static normalize(v: Vector3D): Vector3D {
    const mag = this.magnitude(v);
    if (mag < 1e-8) return [0, 0, 0];
    return [v[0] / mag, v[1] / mag, v[2] / mag];
  }

  static quaternionFromEulerY(degrees: number): Quaternion {
    const rad = (degrees * Math.PI) / 180.0;
    return [Math.cos(rad / 2), 0, Math.sin(rad / 2), 0];
  }

  static quaternionToRotationMatrix(q: Quaternion): Matrix3x3 {
    const [w, x, y, z] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    return [
      1 - (yy + zz), xy - wz,        xz + wy,
      xy + wz,        1 - (xx + zz), yz - wx,
      xz - wy,        yz + wx,        1 - (xx + yy)
    ];
  }

  static transformVectorByMatrix(m: Matrix3x3, v: Vector3D): Vector3D {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
  }

  static getAxesFromRotationMatrix(m: Matrix3x3): [Vector3D, Vector3D, Vector3D] {
    return [
      this.normalize([m[0], m[3], m[6]]),
      this.normalize([m[1], m[4], m[7]]),
      this.normalize([m[2], m[5], m[8]])
    ];
  }

  static buildOBB(
    transform: Transform3D,
    baseBoundingBox: BoundingBox3D,
    clearanceBufferMeters: number = 0
  ): OrientedBoundingBox {
    const rotMatrix = this.quaternionToRotationMatrix(transform.rotation);
    const axes = this.getAxesFromRotationMatrix(rotMatrix);

    const scaledExtents: Vector3D = [
      (baseBoundingBox.extents[0] * transform.scale[0]) + clearanceBufferMeters,
      (baseBoundingBox.extents[1] * transform.scale[1]), 
      (baseBoundingBox.extents[2] * transform.scale[2]) + clearanceBufferMeters
    ];

    const rotatedCenterOffset = this.transformVectorByMatrix(rotMatrix, baseBoundingBox.center);
    const worldCenter = this.add(transform.position, rotatedCenterOffset);

    return {
      center: worldCenter,
      extents: scaledExtents,
      axes
    };
  }

  static testOBBOBBOverlap(a: OrientedBoundingBox, b: OrientedBoundingBox): boolean {
    const T = this.subtract(b.center, a.center);
    const R: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    const AbsR: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];

    const EPSILON = 1e-6;

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        R[i][j] = this.dot(a.axes[i], b.axes[j]);
        AbsR[i][j] = Math.abs(R[i][j]) + EPSILON;
      }
    }

    for (let i = 0; i < 3; i++) {
      const ra = a.extents[i];
      const rb = b.extents[0] * AbsR[i][0] + b.extents[1] * AbsR[i][1] + b.extents[2] * AbsR[i][2];
      if (Math.abs(this.dot(T, a.axes[i])) > ra + rb) return false;
    }

    for (let i = 0; i < 3; i++) {
      const ra = a.extents[0] * AbsR[0][i] + a.extents[1] * AbsR[1][i] + a.extents[2] * AbsR[2][i];
      const rb = b.extents[i];
      if (Math.abs(this.dot(T, b.axes[i])) > ra + rb) return false;
    }

    let ra = a.extents[1] * AbsR[2][0] + a.extents[2] * AbsR[1][0];
    let rb = b.extents[1] * AbsR[0][2] + b.extents[2] * AbsR[0][1];
    if (Math.abs(T[2] * R[1][0] - T[1] * R[2][0]) > ra + rb) return false;

    ra = a.extents[1] * AbsR[2][1] + a.extents[2] * AbsR[1][1];
    rb = b.extents[0] * AbsR[0][2] + b.extents[2] * AbsR[0][0];
    if (Math.abs(T[2] * R[1][1] - T[1] * R[2][1]) > ra + rb) return false;

    ra = a.extents[1] * AbsR[2][2] + a.extents[2] * AbsR[1][2];
    rb = b.extents[0] * AbsR[0][1] + b.extents[1] * AbsR[0][0];
    if (Math.abs(T[2] * R[1][2] - T[1] * R[2][2]) > ra + rb) return false;

    ra = a.extents[0] * AbsR[2][0] + a.extents[2] * AbsR[0][0];
    rb = b.extents[1] * AbsR[1][2] + b.extents[2] * AbsR[1][1];
    if (Math.abs(T[0] * R[2][0] - T[2] * R[0][0]) > ra + rb) return false;

    ra = a.extents[0] * AbsR[2][1] + a.extents[2] * AbsR[0][1];
    rb = b.extents[0] * AbsR[1][2] + b.extents[2] * AbsR[1][0];
    if (Math.abs(T[0] * R[2][1] - T[2] * R[0][1]) > ra + rb) return false;

    ra = a.extents[0] * AbsR[2][2] + a.extents[2] * AbsR[0][2];
    rb = b.extents[0] * AbsR[1][1] + b.extents[1] * AbsR[1][0];
    if (Math.abs(T[0] * R[2][2] - T[2] * R[0][2]) > ra + rb) return false;

    ra = a.extents[0] * AbsR[1][0] + a.extents[1] * AbsR[0][0];
    rb = b.extents[1] * AbsR[2][2] + b.extents[2] * AbsR[2][1];
    if (Math.abs(T[1] * R[0][0] - T[0] * R[1][0]) > ra + rb) return false;

    ra = a.extents[0] * AbsR[1][1] + a.extents[1] * AbsR[0][1];
    rb = b.extents[0] * AbsR[2][2] + b.extents[2] * AbsR[2][0];
    if (Math.abs(T[1] * R[0][1] - T[0] * R[1][1]) > ra + rb) return false;

    ra = a.extents[0] * AbsR[1][2] + a.extents[1] * AbsR[0][2];
    rb = b.extents[0] * AbsR[2][1] + b.extents[1] * AbsR[2][0];
    if (Math.abs(T[1] * R[0][2] - T[0] * R[1][2]) > ra + rb) return false;

    return true; 
  }
}
