# Fixed Precision Impact on State-of-Polarization Sensing
A real-time visualization application developed for the Aston Institute of Photonics Technologies at Aston University, presented at the OFC (Optical Fiber Communication) Conference.

## Overview
This custom software application was created to demonstrate and visualize the impact of fixed precision on State-of-Polarization (SOP) sensing using coherent transceivers. The application provides real-time data visualization of photonics research, including vibration sensing, SOP vector representations, and communication metrics.

The architecture uses a **Selective Forwarding Unit (SFU)** model. The first browser instance to connect is automatically assigned as the **Host**, broadcasting a camera stream. Subsequent instances connect as **Viewers** to consume the forwarded WebRTC stream. A headless data sender (`src/sender.js`) feeds live experiment data into the server, which is then broadcast to all active dashboards.

## Research Team
Aston Institute of Photonics Technologies, Aston University, Birmingham, UK

* Geraldo Gomes
* Rafael Vieira
* Pedro Freire
* Yaroslav Prylepskiy
* Sergei Turitsyn

## Features

### Real-Time Data Visualization
* **Vibration Sensing:** Displays live vibration sensor data and FPGA sensing measurements.
* **State-of-Polarization Visualization:** Interactive 3D spherical graphs showing SOP vectors at three precision levels:
  * Low Precision
  * Medium Precision
  * High Precision
* **Communication Data Monitoring:** Real-time communication metrics and performance data.
* **Video Feed Support:** Native WebRTC SFU streaming directly from the Host camera to all Viewers.

### Security & Session Management
* **Single-Session Flow:** Dynamic assigning of the first connected user as Host. Subsequent clients are held in a waiting state until the Host configures the room.
* **Access Control:** Host configurations include setting the maximum number of viewers, a cryptographically secure 16-digit hexadecimal password, and an IP whitelist.
* **Tarpit Security:** Any unauthorized IP trying to connect to an active session is tarpitted with a 5-second delay to mitigate automated script-scanning.
* **Resilient Data Ingest:** The headless data writer (`src/sender.js`) handles partial file writes safely, ensuring malformed lines do not crash the frontend graphs.
* **Connection Management:** Automatic reconnection with a visual countdown and color-coded statuses (🟢 Connected, 🟡 Error, 🔴 Disconnected).

## Technology Stack

### Frontend
* **React 19.1.1** - UI framework
* **Vite 7.3.0** - Build tool and dev server
* **Three.js 0.180.0** - 3D graphics rendering
* **@react-three/fiber & @react-three/drei** - React renderer for Three.js
* **Chart.js & react-chartjs-2** - Data visualization charts

### Backend & Environment
* **Node.js (v24)** - Server environment
* **ws** - Real-time WebSocket signaling
* **@roamhq/wrtc** - WebRTC implementation for Node.js
* **Nix / Direnv** - Flake-based development shell with Node.js 24 and development headers

## Prerequisites
* **Nix package manager** with `direnv` enabled (highly recommended), OR:
* **Node.js v24.x** installed locally.
* Python 3 and `pkg-config` (required to compile the native `@roamhq/wrtc` dependency).

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

4. Create a `.env` file in the root directory:
   ```env
   VITE_SENDER_KEY=your_secure_sender_token_here
   ```

## Usage

### 1. Start the SFU Server
The unified server coordinates signaling, auth, tarpitting, and WebRTC media forwarding.
```bash
node src/server.js
```
*Starts on `ws://127.0.0.1:8181`.*

### 2. Start the Frontend Application
Run the Vite development server:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.
* The first tab will open the **Host Setup Screen** where you can specify viewer limits, custom passwords, and whitelists.
* Once the Host starts the session, subsequent browser tabs will require the password to view the graphs and video stream.

### 3. Start the Headless Data Sender
Feed simulated photonics data from text files:
```bash
node src/sender.js
```

### Production Build
Build and preview optimized production assets:
```bash
npm run build
npm run preview
```

## Project Structure
```
A-Univ-Project/
├── src/
│   ├── App.jsx                  # Main application container
│   ├── VibrationSensor.jsx      # Vibration visualization
│   ├── SphericalGraph.jsx       # 3D SOP vector rendering
│   ├── CommunicationData.jsx    # Communication metrics
│   ├── sender.js                # Headless data injector
│   ├── server.js                # Unified SFU WebSocket / WebRTC server
│   ├── hooks/
│   │   ├── useExperimentSession.js # WebSocket & session state hook
│   │   └── useWebRTC.js            # WebRTC RTCPeerConnection hook
│   ├── components/
│   │   └── SetupScreen.jsx      # Host setup & viewer auth UI
│   ├── data/                    # Simulated experiment dataset
│   ├── App.css                  # UI Styles
│   ├── index.css                # Global styles
│   └── main.jsx                 # App entry point
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

## WebSocket Protocol
The unified server (`src/server.js`) relays data payloads using the following JSON structures:

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
    [lowBitError, lowSNR],
    [medBitError, medSNR],
    [highBitError, highSNR]
  ]
}
```

## Contact & Licensing
This software was developed specifically for the Photonics Department at Aston University. For questions about this software or the underlying photonics research:

* **Aston Institute of Photonics Technologies**
* Aston University
* Birmingham, United Kingdom

*Presented at the Optical Fiber Communication (OFC) Conference.*
