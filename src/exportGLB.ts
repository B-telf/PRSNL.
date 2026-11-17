import type { Loop } from './Loop';

/**
 * Export Loop's current look as a binary glTF (.glb) for use in other
 * engines and tools. The file holds the static model in its rest shape with
 * the face baked in; the movement itself lives in this library.
 */
export async function exportGLB(loop: Loop): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const shadow = loop.getObjectByName('Shadow');
  const shown = shadow?.visible ?? false;
  if (shadow) shadow.visible = false;
  loop.updateMatrixWorld(true);
  try {
    const result = await new GLTFExporter().parseAsync(loop, { binary: true, onlyVisible: true });
    return result as ArrayBuffer;
  } finally {
    if (shadow) shadow.visible = shown;
  }
}
