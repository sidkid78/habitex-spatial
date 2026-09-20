import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export class SpatialAssetPipeline {
  private static instance: SpatialAssetPipeline;
  private gltfLoader: GLTFLoader;
  private textureLoader: THREE.TextureLoader;
  private ktx2Loader: KTX2Loader | null = null;
  private modelCache = new Map<string, THREE.Group>();
  private textureCache = new Map<string, THREE.Texture>();
  private loadingPromises = new Map<string, Promise<THREE.Group>>();

  private constructor() {
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    dracoLoader.setDecoderConfig({ type: 'js' });
    this.gltfLoader.setDRACOLoader(dracoLoader);

    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }

  public static getInstance(): SpatialAssetPipeline {
    if (!SpatialAssetPipeline.instance) {
      SpatialAssetPipeline.instance = new SpatialAssetPipeline();
    }
    return SpatialAssetPipeline.instance;
  }

  public initKTX2(renderer: THREE.WebGLRenderer): void {
    if (!this.ktx2Loader) {
      this.ktx2Loader = new KTX2Loader();
      this.ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/basis/');
      this.ktx2Loader.detectSupport(renderer);
      this.gltfLoader.setKTX2Loader(this.ktx2Loader);
    }
  }

  public async loadGLB(url: string, onProgress?: (percent: number) => void): Promise<THREE.Group> {
    if (this.modelCache.has(url)) {
      return this.modelCache.get(url)!.clone(true);
    }

    if (this.loadingPromises.has(url)) {
      const base = await this.loadingPromises.get(url)!;
      return base.clone(true);
    }

    const loadPromise = new Promise<THREE.Group>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf: GLTF) => {
          const root = gltf.scene;

          root.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              if (mesh.material) {
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const mat of materials) {
                  if ('envMapIntensity' in mat) {
                    (mat as THREE.MeshStandardMaterial).envMapIntensity = 1.0;
                  }
                  mat.needsUpdate = true;
                }
              }
            }
          });

          this.modelCache.set(url, root);
          this.loadingPromises.delete(url);
          resolve(root.clone(true));
        },
        (xhr) => {
          if (xhr.lengthComputable && onProgress) {
            onProgress(Math.round((xhr.loaded / xhr.total) * 100));
          }
        },
        (error) => {
          this.loadingPromises.delete(url);
          console.error(`[SpatialAssetPipeline] Failed to load 3D GLB: ${url}`, error);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });

    this.loadingPromises.set(url, loadPromise);
    return loadPromise;
  }

  public async loadPBRTexture(url: string, uvScale: [number, number] = [1, 1]): Promise<THREE.Texture> {
    const cacheKey = `${url}_${uvScale[0]}_${uvScale[1]}`;
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)!;
    }

    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        url,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(uvScale[0], uvScale[1]);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          this.textureCache.set(cacheKey, texture);
          resolve(texture);
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err)))
      );
    });
  }

  public launchVisionOSQuickLook(usdzUrl: string): void {
    if (typeof document === 'undefined') return;
    const anchor = document.createElement('a');
    anchor.setAttribute('rel', 'ar');
    anchor.setAttribute('href', usdzUrl);
    anchor.appendChild(document.createElement('img'));
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }
}

export const assetPipeline = SpatialAssetPipeline.getInstance();
