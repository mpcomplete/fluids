const regl = createREGL()
const mouse = {x: 100, y: 100}

const velocity = regl.texture()
const ink = regl.texture()

const drawFeedback = regl({
  frag: `
  precision mediump float;
  uniform sampler2D velocity;
  uniform vec2 mouse;
  // uniform vec2 iResolution;
  uniform float t;

  void main()
  {
  //   // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = gl_FragCoord;
    // vec2 uv = gl_FragCoord/iResolution.xy;

  //   // Time varying pixel color
    vec3 col = 0.5 + 0.5*cos(uv.xyx+vec3(0,2,4));

    // Output to screen
    gl_FragColor = vec4(col, 1.0);
  }`,

  vert: `
  precision mediump float;
  attribute vec2 position;
  varying vec2 uv;
  void main () {
    uv = position;
    gl_Position = vec4(position, 0, 1);
  }`,

  attributes: {
    position: [
      -1, -1,
      -1, 1,
      1, 1,
      -1, -1,
      1, 1,
      1, -1]
  },

  uniforms: {
    velocity: velocity,
    // iResolution: (context) => [context.viewportWidth, context.viewportHeight],
    mouse: ({pixelRatio, viewportHeight}) => [
      mouse.x * pixelRatio,
      viewportHeight - mouse.y * pixelRatio
    ],
    t: ({tick}) => 0.1 * tick
  },

  count: 6
})

regl.frame(function () {
  regl.clear({
    color: [0, 0, 0, 1]
  })

  drawFeedback()

  velocity({
    copy: true
  })
})