import { DIM } from './geometry';
import type { Loop } from './Loop';

/**
 * Export Loop's current look as a binary glTF (.glb) for use in other
 * engines and tools. The file holds the static model in its rest pose with
 * the face baked in; the ghost motion itself lives in this library.
 */
export async function exportGLB(loop: Loop): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const source = loop.model;
  const saved = { p: source.position.clone(), r: source.rotation.clone() };
  // Rest pose: upright, feet on the ground.
  source.position.set(0, DIM.pivotY, 0);
  source.rotation.set(0, 0, 0);
  source.updateMatrixWorld(true);
  try {
    const result = await new GLTFExporter().parseAsync(source, { binary: true, onlyVisible: true });
    return result as ArrayBuffer;
  } finally {
    source.position.copy(saved.p);
    source.rotation.copy(saved.r);
  }
}
