import sources from './anime4k-sources.js';

const downscale = ['AutoDownscalePre_x2', 'AutoDownscalePre_x4'];
export const UPSCALE_PROFILES = Object.freeze({
  off: [],
  fast: ['Clamp_Highlights', 'Upscale_Denoise_CNN_x2_S', ...downscale, 'Upscale_CNN_x2_S'],
  balanced: ['Clamp_Highlights', 'Restore_CNN_Soft_M', 'Upscale_CNN_x2_M', ...downscale, 'Upscale_CNN_x2_S'],
  quality: ['Clamp_Highlights', 'Restore_CNN_VL', 'Upscale_CNN_x2_VL', ...downscale, 'Restore_CNN_M', 'Upscale_CNN_x2_M'],
});
export function normalizeUpscaling(saved) {
  const aliases = { light: 'fast', definition: 'quality', ultra: 'quality' };
  const profile = aliases[saved?.profile] || saved?.profile;
  if (saved?.enabled === false || profile === 'off') return { enabled: false, profile: 'off' };
  return { enabled: true, profile: Object.hasOwn(UPSCALE_PROFILES, profile) ? profile : 'balanced' };
}

// mpv's size/WHEN directives use reverse Polish notation.
export function evaluateSize(expression, named) {
  const stack = [];
  for (const token of expression.trim().split(/\s+/)) {
    if (['+', '-', '*', '/', '>', '<'].includes(token)) {
      const b = stack.pop(), a = stack.pop();
      stack.push(token === '+' ? a+b : token === '-' ? a-b : token === '*' ? a*b : token === '/' ? a/b : token === '>' ? +(a>b) : +(a<b));
    } else if (/^-?\d/.test(token)) stack.push(Number(token));
    else { const [name, axis] = token.split('.'); stack.push(named[name]?.[axis === 'w' ? 'width' : 'height']); }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) throw new Error(`Invalid shader expression: ${expression}`);
  return stack[0];
}
export function parsePasses(source) {
  return source.split('//!DESC ').slice(1).map(block => {
    const directive = (key, fallback) => block.match(new RegExp('^//!'+key+' (.+)$','m'))?.[1].trim() || fallback;
    const hook = directive('HOOK', 'MAIN');
    const binds = [...new Set([...block.matchAll(/^\/\/!BIND (\w+)/gm)].map(m=>m[1] === 'HOOKED' ? 'MAIN' : m[1]))];
    const body = block.slice(block.indexOf('\n')).replace(/^\/\/!.*$/gm, '').replace(/\bHOOKED_/g, 'MAIN_');
    const uniforms = binds.map(name => `uniform sampler2D ${name}_sampler;\nuniform vec2 ${name}_size;\n#define ${name}_pos uv\n#define ${name}_pt (1.0/${name}_size)\n#define ${name}_tex(p) texture(${name}_sampler,p)\n#define ${name}_texOff(p) texture(${name}_sampler,uv+vec2(p)/${name}_size)`).join('\n');
    return { hook, binds, save: directive('SAVE','MAIN'), width: directive('WIDTH','MAIN.w'), height: directive('HEIGHT','MAIN.h'), when: directive('WHEN','1'),
      fragment: `#version 300 es\nprecision highp float;\nin vec2 uv;\nout vec4 color;\n${uniforms}\n${body}\nvoid main(){color=hook();}` };
  });
}
const vertex = `#version 300 es
in vec2 a_position; out vec2 uv;
void main(){uv=a_position*0.5+0.5;gl_Position=vec4(a_position,0.,1.);}`;

export function mountUpscaling(video, canvas, profile, onUnavailable, onActive) {
  if (!video || !canvas || !UPSCALE_PROFILES[profile]?.length) return null;
  let gl, buffer, input, copy, stages = [], frame = null, active = true, observer, lastTime = -1;
  const textures = [], framebuffers = [], programs = [];
  const listeners = new AbortController();
  const videoFrames = typeof video.requestVideoFrameCallback === 'function';
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader,source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) { const error=gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw Error(error); }
    return shader;
  }
  function program(fragment) {
    const v = compile(gl.VERTEX_SHADER, vertex); let f, p;
    try {
      f=compile(gl.FRAGMENT_SHADER,fragment); p=gl.createProgram();
      gl.attachShader(p,v); gl.attachShader(p,f); gl.linkProgram(p);
      if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
      programs.push(p); return p;
    } catch(error) { if(p) gl.deleteProgram(p); throw error; }
    finally { gl.deleteShader(v); if(f) gl.deleteShader(f); }
  }
  function texture() {
    const t=gl.createTexture(); textures.push(t); gl.bindTexture(gl.TEXTURE_2D,t);
    for (const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
    for (const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
    return t;
  }
  function hide() { canvas.hidden=true; video.classList.remove('is-upscaled'); }
  function dispose() {
    if (!active) return;
    active=false; listeners.abort(); observer?.disconnect();
    if(frame!==null) { if(videoFrames) video.cancelVideoFrameCallback(frame); else cancelAnimationFrame(frame); }
    hide();
    if(gl && !gl.isContextLost()) {
      textures.forEach(t=>gl.deleteTexture(t)); framebuffers.forEach(f=>gl.deleteFramebuffer(f)); programs.forEach(p=>gl.deleteProgram(p));
      if(buffer) gl.deleteBuffer(buffer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
  function fail(error) { console.warn('Anime4K v4:',error); dispose(); onUnavailable?.(error); }
  try {
    gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'high-performance'});
    if(!gl || !gl.getExtension('EXT_color_buffer_float')) throw Error('Floating point WebGL2 unavailable');
    buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    input=texture();
    // PREKERNEL (highlight clamp) runs after all MAIN passes, as in mpv.
    const passes=UPSCALE_PROFILES[profile].flatMap(name=>parsePasses(sources[name]));
    stages=[...passes.filter(p=>p.hook==='MAIN'),...passes.filter(p=>p.hook==='PREKERNEL')].map(pass=>{
      const tex=texture(), fb=gl.createFramebuffer(); framebuffers.push(fb);
      return {...pass, program:program(pass.fragment), texture:tex, fb, w:0, h:0};
    });
    copy=program(`#version 300 es\nprecision highp float;\nin vec2 uv;\nuniform sampler2D image;\nout vec4 color;\nvoid main(){color=vec4(texture(image,uv).rgb,1.);}`);
  } catch(error) { fail(error); return null; }
  function draw(p) {
    gl.useProgram(p); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    const attr=gl.getAttribLocation(p,'a_position'); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
  }
  function paint() {
    if(!active || !video.videoWidth || video.readyState<2 || video.seeking) return;
    try {
      const rect=video.getBoundingClientRect(), ratio=video.videoWidth/video.videoHeight;
      const fitted=Math.min(rect.width,rect.height*ratio);
      if(fitted<=0) return;
      const width=Math.max(1,Math.round(fitted*devicePixelRatio)), height=Math.max(1,Math.round(width/ratio));
      canvas.style.width=`${fitted}px`; canvas.style.height=`${fitted/ratio}px`;
      if(canvas.width!==width || canvas.height!==height) { canvas.width=width; canvas.height=height; }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,input); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video);
      const native={texture:input,width:video.videoWidth,height:video.videoHeight};
      const named={MAIN:native,NATIVE:native,OUTPUT:{width,height}};
      const limit=gl.getParameter(gl.MAX_TEXTURE_SIZE);
      for(const pass of stages) {
        if(!evaluateSize(pass.when,named)) continue;
        const pw=Math.max(1,Math.round(evaluateSize(pass.width,named))), ph=Math.max(1,Math.round(evaluateSize(pass.height,named)));
        if(pw>limit || ph>limit) throw Error('Video exceeds GPU texture limits');
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,pass.texture);
        const resized=pass.w!==pw || pass.h!==ph;
        if(resized) { gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,pw,ph,0,gl.RGBA,gl.HALF_FLOAT,null); pass.w=pw; pass.h=ph; }
        gl.bindFramebuffer(gl.FRAMEBUFFER,pass.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,pass.texture,0);
        if(resized && gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error('Framebuffer unavailable');
        gl.viewport(0,0,pw,ph); draw(pass.program);
        pass.binds.forEach((name,i)=>{
          const item=named[name]; if(!item) throw Error(`Missing shader input ${name}`);
          gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,item.texture);
          gl.uniform1i(gl.getUniformLocation(pass.program,`${name}_sampler`),i);
          gl.uniform2f(gl.getUniformLocation(pass.program,`${name}_size`),item.width,item.height);
        });
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4); named[pass.save]={texture:pass.texture,width:pw,height:ph};
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,width,height); draw(copy);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,named.MAIN.texture); gl.uniform1i(gl.getUniformLocation(copy,'image'),0);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      if(gl.isContextLost() || gl.getError()!==gl.NO_ERROR) throw Error('GPU draw failed');
      if(canvas.hidden) { canvas.hidden=false; video.classList.add('is-upscaled'); onActive?.(); }
    } catch(error) { fail(error); }
  }
  function schedule() {
    if(!active) return;
    if(videoFrames) frame=video.requestVideoFrameCallback(()=>{frame=null; if(!document.hidden) paint(); schedule();});
    else frame=requestAnimationFrame(()=>{frame=null; if(!document.hidden && lastTime!==video.currentTime) {lastTime=video.currentTime;paint();} schedule();});
  }
  for(const event of ['loadeddata','seeked','play','pause','resize']) video.addEventListener(event,paint,{signal:listeners.signal});
  for(const event of ['emptied','seeking','error']) video.addEventListener(event,hide,{signal:listeners.signal});
  document.addEventListener('fullscreenchange',paint,{signal:listeners.signal});
  document.addEventListener('visibilitychange',paint,{signal:listeners.signal});
  window.addEventListener('resize',paint,{signal:listeners.signal});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fail(Error('WebGL context lost'));},{signal:listeners.signal});
  observer=new ResizeObserver(paint); observer.observe(video);
  paint(); schedule();
  return {dispose};
}
