// ============================================================================
// treelet.js - Array Texture Writer
//
// Sub-region uploads into a three.js DataArrayTexture (TEXTURE_2D_ARRAY).
// Three manages allocation (texStorage3D, sampler state, context restore);
// this helper performs the per-layer / per-mip / per-strip texSubImage3D
// calls three's API cannot express, with fully explicit pixel-store state so
// nothing leaks in from (or out to) other texture uploads.
// ============================================================================

import type { DataArrayTexture, WebGLRenderer } from 'three';

export class ArrayTextureWriter {
  private gl: WebGL2RenderingContext | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly texture: DataArrayTexture,
  ) {}

  /**
   * Bind the texture for uploads. Returns false if the context is lost or
   * the texture could not be initialized; callers should retry later.
   */
  begin(): boolean {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl.isContextLost()) return false;

    let props = this.renderer.properties.get(this.texture) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) {
      this.renderer.initTexture(this.texture);
      props = this.renderer.properties.get(this.texture) as { __webglTexture?: WebGLTexture };
    }
    if (!props.__webglTexture) return false;

    // Bind through three's state manager so its binding cache stays correct.
    this.renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
    this.gl = gl;
    return true;
  }

  /** Upload a w×h block into `layer` at mip `level`. Must be inside begin()/end(). */
  write(
    level: number,
    x: number,
    y: number,
    layer: number,
    w: number,
    h: number,
    format: number,
    type: number,
    data: ArrayBufferView,
  ): void {
    const gl = this.gl;
    if (!gl) return;
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, x, y, layer, w, h, 1, format, type, data);
  }

  /** Unbind and restore three's expected default alignment. */
  end(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.renderer.state.unbindTexture();
    this.gl = null;
  }

  get context(): WebGL2RenderingContext | null {
    return this.gl;
  }
}
