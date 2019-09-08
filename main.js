const regl = require('regl')({
  extensions: [ 'OES_texture_float', 'OES_texture_float_linear' ]
});
const extend = (a, b) => Object.assign(b, a)

const SIZE = 512;
const TEX_PROPS = {
  type: 'float', 
  format: 'rgba',
  mag: 'linear',
  min: 'linear',
  wrap: 'repeat',
  width: SIZE, 
  height: SIZE
}

function createFBO(data) {
 return regl.framebuffer({
    color: regl.texture(extend(TEX_PROPS, {data})),
    depthStencil: false
  });
}

function createDoubleFBO(data) {
  return {
    src: createFBO(data),
    dst: createFBO(data),
    swap: function() {
      [this.src, this.dst] = [this.dst, this.src];
    }
  }
}

function myregl(p) {
  return regl(extend(p, {
    vert: `
    precision mediump float;
    attribute vec2 position;
    varying vec2 uv;
    void main () {
      uv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0., 1.);
    }`,
    
    attributes: {
      position: [
        -1, -1,
        -1, 1,
        1, 1,
        -1, -1,
        1, 1,
        1, -1
      ]
    },

    count: 6,
  }));
}

var velocity = createDoubleFBO(
  (Array(SIZE * SIZE * 4)).fill(0));
var ink = createDoubleFBO(
  (Array(SIZE * SIZE * 4)).fill(0).map(
    () => Math.random() > 0.99 ? 80 : 0));
// var ink = createDoubleFBO(
//   (Array(SIZE * SIZE * 4)).fill(0));

var mouse = {pos: [0.0, 0.0], delta: [0.0, 0.0], isDown: false};
var reglCanvas = document.getElementsByTagName("canvas")[0];

reglCanvas.addEventListener('mousedown', e => {
  updateMouse(e);
});
reglCanvas.addEventListener('mousemove', e => {
  if (!mouse.isDown)
    return;
  updateMouse(e, true);
});
window.addEventListener('mouseup', () => {
  mouse = {pos: [0.0, 0.0], delta: [0.0, 0.0], isDown: false};
});

function updateMouse(e, delta) {
  var lastPos = mouse.pos;
  mouse.pos = [Math.floor(e.offsetX * window.devicePixelRatio) / reglCanvas.width,
               1.0 - Math.floor(e.offsetY * window.devicePixelRatio) / reglCanvas.height];
  mouse.isDown = true;
  if (delta) {
    mouse.delta = [mouse.pos[0] - lastPos[0], mouse.pos[1] - lastPos[1]];
  } else {
    mouse.delta = [0.0, 0.0];
  }
  mouse.color = [0.0, 0.4, .4];

  console.log("mouse: ", mouse.pos, mouse.delta);
}

const advect = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D velocity;
  uniform sampler2D quantity;
  uniform float gridSize;
  uniform float dt;
  varying vec2 uv;

  void main() {
    vec2 u = texture2D(velocity, uv).xy;
    vec2 uvOld = uv - u*gridSize*dt;
    gl_FragColor = vec4(texture2D(quantity, uvOld).rgb, 1.);
  }`,

  uniforms: {
    velocity: regl.prop('velocity'),
    quantity: regl.prop('quantity'),
    dt: 1./60,
    gridSize: 1./SIZE,
  },

  framebuffer: regl.prop('framebuffer'),
});

const applyForce = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D velocity;
  uniform vec2 mouse;
  uniform vec2 mouseDelta;
  uniform float gridSize;
  uniform float dt;
  varying vec2 uv;

  void main() {
    float d = 10.*max(0.1 - distance(uv, mouse.xy), 0.);
    vec2 u = texture2D(velocity, uv).xy;
    // u += mouseDelta*d*dt*gridSize;
    u += mouseDelta*d*100.;
    gl_FragColor = vec4(u.xy, 0., 1.);
  }`,

  uniforms: {
    velocity: regl.prop('velocity'),
    mouse: () => mouse.pos,
    mouseDelta: () => mouse.delta,
    mouseColor: () => mouse.color || [1.0, 0, 0],
    dt: 1./60,
    gridSize: 1./SIZE,
  },

  framebuffer: regl.prop('framebuffer'),
});

const applyInk = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D ink;
  uniform vec2 mouse;
  uniform vec2 mouseDelta;
  uniform vec3 mouseColor;
  uniform float gridSize;
  uniform float dt;
  varying vec2 uv;

  void main() {
    float d = 1.*max(0.1 - distance(uv, mouse.xy), 0.);
    vec3 origColor = texture2D(ink, uv).rgb;
    gl_FragColor = vec4(d*mouseColor + origColor, 1.);
  }`,

  uniforms: {
    ink: regl.prop('ink'),
    mouse: () => mouse.pos,
    mouseDelta: () => mouse.delta,
    mouseColor: () => mouse.color || [1.0, 0, 0],
    dt: 1./60,
    gridSize: 1./SIZE,
  },

  framebuffer: regl.prop('framebuffer'),
});

const draw = myregl({
  frag: `
  precision mediump float;
  uniform sampler2D quantity;
  varying vec2 uv;

  void main() {
    gl_FragColor = vec4(texture2D(quantity, uv).rgb, 1.);
  }`,

  uniforms: {
    quantity: regl.prop('quantity'),
  },

//  framebuffer: regl.prop('framebuffer'),
})

regl.frame(function () {
  regl.clear({
    color: [0, 0, 0, 1]
  })

  advect({velocity: velocity.src, quantity: velocity.src, framebuffer: velocity.dst});
  advect({velocity: velocity.src, quantity: ink.src, framebuffer: ink.dst});

  if (mouse.isDown) {
    velocity.swap();
    applyForce({velocity: velocity.src, framebuffer: velocity.dst});

    ink.swap();
    applyInk({ink: ink.src, framebuffer: ink.dst});
    console.log("inking:", mouse.pos);
  }

  draw({quantity: ink.dst});
  // draw({quantity: velocity.dst});
  velocity.swap();
  ink.swap();
})
