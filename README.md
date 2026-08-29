# Fixed Precision Impact on State-of-Polarization Sensing
A real-time visualization application developed for the Aston Institute of Photonics Technologies at Aston University, presented at the OFC (Optical Fiber Communication) Conference.

## Overview
This custom software application was created to demonstrate and visualize the impact of fixed precision on State-of-Polarization (SOP) sensing using coherent transceivers. The application provides real-time data visualization of photonics research, including vibration sensing, SOP vector representations, and communication metrics.

The architecture uses a **Selective Forwarding Unit (SFU)** model. The first browser instance to connect is automatically assigned as the **Host**, broadcasting a camera stream and dataset measurements. Subsequent instances connect as **Viewers** to consume the forwarded WebRTC video stream and synchronized photonics data.

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
* **State-of-Polarization Visualization:** Interactive 3D spherical graphs showing SOP vectors at three precision levels:
  * Low Precision
  * Medium Precision
  * High Precision
* **Communication Data Monitoring:** Real-time 2D constellation scatter plots with precision-tiered SNR distributions.
* **Video Feed Support:** Native WebRTC SFU streaming directly from the Host camera to all Viewers.

### Host GUI Data Transmission Engine
* **Single-Session Host Control:** The Host controls both video broadcasting and data transmission directly from the dashboard GUI.
* **Dual Data Modes:**
  * **Debug / Simulation Mode:** Generates realistic synthetic photonics data directly in browser memory (0 bytes written to disk, preventing test storage ballooning).
  * **Live Experiment Files Mode:** Allows the Host to select local experiment files from their machine, enforcing strict 8/8 filename validation and tailing live appended measurements.
* **Enforced File Naming System:** Validates and matches all 8 required experiment files:
  1. `VibrationData.txt`
  2. `VibrationData_FPGA.txt`
  3. `SphericalData_low.txt`
  4. `SphericalData_medium.txt`
  5. `SphericalData_high.txt`
  6. `CommunicationData_low.txt`
  7. `CommunicationData_medium.txt`
  8. `CommunicationData_high.txt`

### Security & Session Management
* **Single-Session Flow:** Dynamic assignment of the first connected user as Host. Subsequent clients are held in a waiting state until the Host configures the room.
* **Hardened Attack Surface:** Phased out external sender endpoints; the Host browser is the sole authenticated authority for video and data streams.
* **Access Control:** Host configurations include setting the maximum number of viewers, a cryptographically secure 16-digit hexadecimal password, and an IP whitelist.
* **Tarpit Security:** Any unauthorized IP trying to connect to an active session is tarpitted with a 5-second delay to mitigate automated script-scanning.
* **Connection Management:** Automatic reconnection with color-coded statuses (🟢 Connected, 🟡 Error, 🔴 Disconnected).

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
The unified server coordinates signaling, auth, tarpitting, WebRTC media forwarding, and data relay:
```bash
node src/server.js
```
*Starts on `ws://127.0.0.1:8181`.*

### 2. Start the Frontend Application
Run the Vite development server:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser:
* The first tab will open the **Host Setup Screen** where you can specify viewer limits, custom passwords, and whitelists.
* Once the Host starts the session, the Host can start the camera feed and broadcast dataset measurements (in either **Debug** or **Live File** mode).
* Subsequent browser tabs connect as Viewers, enter the password, and receive live video and data streams in real time.

### 3. Safe Mock Experiment Simulation (Optional Testing)
To test live file appending without modifying or corrupting sample datasets, run the mock experiment writer:
```bash
npm run mock-experiment
```
* Creates a temporary `test_experiment_data/` folder with all 8 required files and continuously appends live measurements.
* Point the Host GUI file picker to `test_experiment_data/`.
* Press `Ctrl+C` to stop; the temporary directory is automatically deleted and cleaned up.

### Production Build
Build and preview optimized production assets:
```bash
npm run build
npm run preview
```

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
