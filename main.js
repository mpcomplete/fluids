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
    () => Math.random() > 0.99 ? 20 : 0));
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
  mouse.color = generateColor();

  console.log("mouse: ", mouse.pos, mouse.delta);
}

function generateColor () {
  let c = HSVtoRGB(Math.random(), 1.0, 1.0);
  c[0] *= 0.15;
  c[1] *= 0.15;
  c[2] *= 0.15;
  return c;
}

function HSVtoRGB (h, s, v) {
  let r, g, b, i, f, p, q, t;
  i = Math.floor(h * 6);
  f = h * 6 - i;
  p = v * (1 - s);
  q = v * (1 - f * s);
  t = v * (1 - (1 - f) * s);

  switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
  }

  return [
      r,
      g,
      b
  ];
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
  uniform vec3 color;
  uniform float gridSize;
  uniform float dt;
  varying vec2 uv;

  void main() {
    vec2 p = uv - mouse.xy;
    float d = exp(-dot(p, p) / .001);
    vec3 u = color*d;
    gl_FragColor = vec4(u, 1.);
  }`,

  uniforms: {
    color: regl.prop('color'),
    mouse: () => mouse.pos,
    dt: 1./60,
    gridSize: 1./SIZE,
  },

  blend: {
    enable: true,
    func: {src: 'one', dst: 'one'},
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
    applyForce({color: [1000*mouse.delta[0], 100*mouse.delta[1], 0.], framebuffer: velocity.dst});
    applyForce({color: mouse.color, framebuffer: ink.dst});
    console.log("inking:", mouse.pos);
  }

  draw({quantity: ink.dst});
  // draw({quantity: velocity.dst});
  velocity.swap();
  ink.swap();
})
