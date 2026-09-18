# Fixed Precision Impact on State-of-Polarization Sensing
A real-time visualization application developed for the Aston Institute of Photonics Technologies at Aston University, to be presented at the OFC Conference.

## Overview
This custom software application was created to demonstrate and visualize the impact of fixed precision on State-of-Polarization (SOP) sensing using coherent transceivers. The application provides real-time data visualization of photonics research, including vibration sensing, SOP vector representations, and communication metrics.


The architecture uses a **Selective Forwarding Unit (SFU)**. New browser sockets wait unassigned until the presenter claims the host role with the token printed by the server; subsequent instances connect as **Viewers** to receive the video stream and data.

## Research Team
Aston Institute of Photonics Technologies, Aston University, Birmingham, UK

* Geraldo Gomes
* Rafael Vieira
* Pedro Freire
* Yaroslav Prylepskiy
* Sergei Turitsyn

---

## Features

### Real-Time Data Visualization
* **Vibration Sensing:** Displays live vibration sensor data and FPGA sensing measurements.
* **State-of-Polarization Visualization:** 3D spherical graphs showing SOP vectors at three precision levels:
  * Low Precision
  * Medium Precision
  * High Precision
* **Communication Data Monitoring:** 2D constellation scatter plots with SNR distributions.
* **Video Feed Support:** Video streaming directly from the Host camera to all Viewers.

### Host GUI Data Transmission Engine
* **Single-Session Host Control:** The presenter claims the Host role with the terminal token, then controls both video broadcasting and data transmission from the dashboard.
* **Dual Data Modes:**
  * **Debug / Simulation Mode:** Generates photonics data directly in browser memory.
  * **Live Experiment Files Mode:** Allows the Host to select local experiment files from their machine.
* **Server-local experiment data:** Live mode reads named files from the server-local directory supplied by the Host; missing files simply produce no live packets. The expected names are:
  1. `VibrationData.txt`
  2. `VibrationData_FPGA.txt`
  3. `SphericalData_low.txt`
  4. `SphericalData_medium.txt`
  5. `SphericalData_high.txt`
  6. `CommunicationData_low.txt`
  7. `CommunicationData_medium.txt`
  8. `CommunicationData_high.txt`

### Security & Session Management
* **Single-Session Flow:** Explicit, bounded host-token claim. Subsequent clients are held in a waiting state until the Host configures the room.
* **Access Control:** Host configurations allow them to set the maximum number of viewers, a cryptographically secure 16-digit hexadecimal password, and an IP whitelist.
* **Connection Management:** Automatic reconnect with capped exponential backoff and color-coded statuses (🟢 Connected, 🟡 Error, 🔴 Disconnected).

---

## Technology Stack

### Frontend
* **React 19.1.1** - UI framework
* **Vite 7.3.0** - Build tool and dev server
* **Three.js 0.180.0** - 3D graphics rendering
* **@react-three/fiber & @react-three/drei** - React renderer for Three.js
* **Chart.js & react-chartjs-2** - Data visualization charts

### Backend & Environment
* **Node.js (v24)** - Server environment
* **ws** - Real-time WebSocket signaling & data relay
* **@roamhq/wrtc** - WebRTC SFU implementation for Node.js
* **Nix / Direnv** - Flake-based development shell with Node.js 24 and native headers

---

## Prerequisites
* **Nix package manager** with `direnv` enabled (recommended), OR:
* **Node.js v24.x** installed locally.
* Python 3 and `pkg-config` (required to compile the native `@roamhq/wrtc` dependency).

---

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/rayyan-parkar/A-Univ-Project.git
   cd A-Univ-Project
   ```

2. If using Nix and `direnv`, allow the directory environment:
   ```bash
   direnv allow
   ```
   *(This automatically loads Node.js v24, Python 3, and package compilation tools).*

3. Install dependencies:
   ```bash
   npm install
   ```

---

## Usage

### 1. Start the SFU Server
```bash
node src/server.js
```
*Starts on `http://127.0.0.1:8181` and serves WebSocket `/ws`. The terminal prints `HOST_TOKEN=...` after the server begins listening; enter that token in the presenter browser. The token is kept only in the browser session and server memory.*

The default localhost binding is intentional for the phase-2 deployment. Tailscale proxy identity/IP allowlisting remains deferred; do not treat a proxied client address as an end-to-end allowlist identity.

### 2. Start the Frontend Application
Run the Vite development server:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser:
* The first tab waits for a presenter token. Enter the `HOST_TOKEN` printed in the server terminal to open the **Host Setup Screen**, where you can specify viewer limits, custom passwords, and whitelists.
* Once the Host starts the session, the Host can start the camera feed and broadcast dataset measurements (in either **Debug** or **Live File** mode).
* Subsequent browser tabs connect as Viewers, enter the password, and receive live video and data streams in real time.

### 3. Safe Mock Experiment Simulation (Optional Testing)
To test live file appending without modifying or corrupting sample datasets, run the mock experiment writer:
```bash
npm run mock-experiment
```
* Creates a temporary `test_experiment_data/` folder with all 8 required files and continuously appends live measurements.
* Point the Host GUI directory field to `test_experiment_data/`.
* Press `Ctrl+C` to stop; the temporary directory is automatically deleted and cleaned up.

### Production Build
Build and preview optimized production assets:
```bash
npm run build
npm run preview
```

### Private Tailscale deployment (phase 1)
The production server serves both the built frontend and WebSocket signaling from one
same-origin HTTP server. It binds to `127.0.0.1:8181` by default, so it is suitable
for a private Tailscale Serve proxy. Override the bind address or port only when
needed with bounded `HOST` and `PORT` environment variables.

```bash
npm run build
npm run server
tailscale serve --bg http://127.0.0.1:8181
```

Open the HTTPS URL printed by `tailscale serve status` from a device on the same
tailnet. Tailscale terminates HTTPS/WSS; the Node server remains plain HTTP on
localhost. The host can use that private HTTPS URL (or open `http://127.0.0.1:8181`
directly on the server computer). Check `http://127.0.0.1:8181/healthz` when
diagnosing startup.

---

## Project Structure
```
A-Univ-Project/
├── src/
│   ├── App.jsx                  # Main application dashboard
│   ├── VibrationSensor.jsx      # Vibration & FPGA visualization
│   ├── SphericalGraph.jsx       # 3D Poincaré SOP vector rendering
│   ├── CommunicationData.jsx    # 2D Constellation scatter charts
│   ├── server.js                # Unified SFU WebSocket / WebRTC server
│   ├── hooks/
│   │   ├── useDataBroadcaster.js   # Host data transmission engine (Debug/Live)
│   │   ├── useExperimentSession.js # WebSocket & session state management
│   │   └── useWebRTC.js            # WebRTC RTCPeerConnection management
│   ├── components/
│   │   └── SetupScreen.jsx      # Host configuration & viewer authentication UI
│   ├── data/                    # Sample experiment datasets
│   ├── App.css                  # Dashboard styling & layout
│   ├── index.css                # Global CSS reset & tokens
│   └── main.jsx                 # App entry point
├── scripts/
│   └── mock_experiment_writer.js # Safe live file-tailing test generator
├── public/
│   ├── logo.png                 # Institution logo
│   ├── right-logo.jpg           # Secondary logo
│   └── video-unavailable.jpg    # Placeholder fallback image
├── flake.nix                    # Nix package declaration
├── flake.lock                   # Nix lockfile
├── .envrc                       # direnv script
├── index.html                   # HTML entrypoint
├── vite.config.js               # Vite builder config
├── package.json                 # Node dependencies and scripts
└── eslint.config.js             # Linter config
```

---

## WebSocket Protocol
The unified server (`src/server.js`) relays data payloads from the Host to all authenticated Viewers:

### Waveform Data
```json
{
  "type": "waveform",
  "data": [vibrationValue, fpgaValue]
}
```

### Vector Data (SOP)
```json
{
  "type": "vector",
  "data": [
    [x1, y1, z1], [x2, y2, z2], [x3, y3, z3],  // Low precision
    [x4, y4, z4], [x5, y5, z5], [x6, y6, z6],  // Medium precision
    [x7, y7, z7], [x8, y8, z8], [x9, y9, z9]   // High precision
  ]
}
```

### Communication Data
```json
{
  "type": "communication",
  "data": [
    [lowX, lowY],
    [medX, medY],
    [highX, highY]
  ]
}
```

---

## Contact & Licensing
Developed for the Photonics Department at Aston University.

* **Aston Institute of Photonics Technologies**
* Aston University
* Birmingham, United Kingdom

*Presented at the Optical Fiber Communication (OFC) Conference.*
*Dashboard built by Rayyan Parkar.*
