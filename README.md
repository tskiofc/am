# OpenMotion

**OpenMotion** is a web port of the original **Alight Motion** engine and user interface. This version brings the original Alight Motion runtime to the modern web environment as a foundational milestone.

---

## Vision & Roadmap

The primary objective of this project is to build a **native desktop port powered by Rust**:

- **Native Desktop Engine (Rust):** Port the core rendering pipeline and timeline engine to Rust for peak multi-threaded performance, minimal memory footprint, and low-level GPU acceleration (Vulkan / Metal / DirectX via WGPU).
- **Desktop-First UI/UX:** Overhaul the interface—currently designed around mobile touch workflows—into a fully optimized desktop layout featuring dockable panels, wide timeline tracks, multi-window support, and dedicated keyboard/mouse workflows.
- **Ecosystem & Compatibility:** Preserve full backward and forward compatibility with Alight Motion XML / AMFX preset formats to ensure seamless interoperability across mobile, web, and desktop.

For detailed technical milestones and crate-level breakdown, see **[ROADMAP.md](ROADMAP.md)**.

---

## Current Status (Web Version)

The current web build mirrors the authentic Alight Motion engine and layout with high fidelity:

- **Rendering Engine:** WebGL 2D/3D compositing, blend modes, masking pipelines, and cubic bezier keyframe interpolation.
- **Mobile-Accurate Interface:** Playbar, multi-track timeline, Move & Transform inspector, Color & Fill, Border & Shadow, and FX parameter controls.
- **Audio & Media:** Audio scrubbing, bilateral VU meter, and per-layer media replacement.
- **Export Pipeline:** MP4 video export (via WebCodecs with FFmpeg WASM fallback) and XML project packaging.

---

## Project Structure

```
.
├── index.html          – Application shell & viewport setup
├── preset.js           – Core engine (scene graph, XML/AMFX parser, WebGL renderer)
├── am-mobile-ui.js     – Mobile interface controller
├── am-mobile-ui.css    – Mobile interface styles
├── am-movetransform.js – Move & Transform engine
├── chunk.js            – GLSL shader compiler & math curve routines
├── ffmpeg-export-v2.js – MP4 video exporter
├── lib/server.cjs      – Static server, asset proxy & project API
├── api/index.cjs       – Vercel serverless adapter for the API
├── vercel.json         – Vercel routing & function configuration
├── effects/            – Effect shaders and binary definitions
├── shapes/             – Live shape geometry definitions
└── icons/              – SVG UI icon assets
```

---

## Running Locally

### Prerequisites
- Node.js (v18 or higher recommended)

### Start Development Server
```bash
npm start
```

Or directly:
```bash
node lib/server.cjs
```

Open your browser and navigate to:
```
http://localhost:3000/
```
To load simple mode, append the query parameter: `?mode=simple`.