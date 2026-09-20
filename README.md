# Fixed-Precision Impact on State-of-Polarization Sensing

A real-time visualization and streaming platform for demonstrating the effect of fixed numerical precision on **State-of-Polarization (SOP) sensing using coherent optical transceivers**.

Developed for the **Aston Institute of Photonics Technologies, Aston University**, for demonstration at the **Optical Fiber Communication (OFC) Conference**.

## What it does

The application provides a synchronized browser-based view of:

* Live presenter camera video
* Optical and FPGA vibration measurements
* 3D Stokes / Poincaré sphere vectors at low, medium, and high precision
* Communication constellation scatter plots at low, medium, and high precision

One browser acts as the **Host/Presenter** and controls the experiment. Other browsers join as **Viewers**.

```text
                         ┌──────────────────┐
                         │ Host / Presenter │
                         │      Browser     │
                         └───────┬──────────┘
                                 │
                    WebRTC video │ Telemetry
                                 ▼
                      ┌────────────────────┐
                      │   Node.js Server   │
                      │ WebSocket + WebRTC │
                      │        SFU         │
                      └─────────┬──────────┘
                                │
                 ┌──────────────┼──────────────┐
                 ▼              ▼              ▼
             Viewer 1       Viewer 2       Viewer N
```

The Node.js server handles authentication, session management, telemetry distribution, WebRTC forwarding, reconnect/recovery behaviour, rate limiting, heartbeat detection, and static application serving.

---

## Quick Start

### Requirements

* Node.js **20, 22, or 24**
* npm
* Python 3 and native C/C++ build tools

Native build tools are required by `@roamhq/wrtc`.

### Install

```bash
git clone https://github.com/rayyan-parkar/A-Univ-Project.git
cd A-Univ-Project
npm install
```

### Build and run

```bash
npm run build
npm run server
```

The server starts on:

```text
http://127.0.0.1:8181
```

It also prints a secret host token:

```text
HOST_TOKEN=<generated-token>
```

Keep this token private. It is required to claim the Host role and is stored only in server memory.

---

## Host / Presenter

Open:

```text
http://localhost:8181
```

Enter the `HOST_TOKEN` printed by the server and select **Claim Host**.

Configure the session:

* **Viewer Password** — automatically generated or manually specified
* **Max Viewers** — optional viewer limit
* **IP Allowlist** — optional comma-separated list of permitted viewer addresses

Select **Start Session**.

### Camera

Select **Start Camera** and grant camera permission when prompted.

The camera stream is forwarded to authenticated viewers through WebRTC.

### Experiment data

Two data sources are supported.

#### Debug simulation

Select **Start Debug** to generate synthetic experiment telemetry without laboratory equipment.

Use this mode for development, demonstrations, and interface testing.

#### Live experiment ingest

For real measurements, provide a directory containing exactly:

```text
VibrationData.txt
VibrationData_FPGA.txt

SphericalData_low.txt
SphericalData_medium.txt
SphericalData_high.txt

CommunicationData_low.txt
CommunicationData_medium.txt
CommunicationData_high.txt
```

Example paths:

```text
Windows:
C:\Experiments\Session_1

Linux/macOS:
/home/user/experiments/session_1
```

Enter the absolute directory path in **Live Directory**, then select **Start Live Ingest**.

The ingest engine reads the eight streams synchronously and broadcasts complete telemetry frames to connected clients.

---

## Testing live ingest without laboratory equipment

A mock experiment writer is included:

```bash
npm run mock-experiment
```

It creates an isolated temporary experiment directory and continuously appends valid synthetic measurements.

Example:

```text
Mock experiment directory: /tmp/a-univ-experiment-12345/
Writing live rows every 33ms... Press Ctrl+C to stop.
```

Copy the generated directory into the application's **Live Directory** field and start live ingest.

Press `Ctrl+C` when finished. The temporary dataset is cleaned up automatically.

---

## Viewer

Viewers require only a modern web browser.

Open the URL supplied by the presenter and enter the **Viewer Password**.

The viewer dashboard displays:

* Presenter video
* Optical/FPGA vibration waveform
* Interactive 3D Stokes / Poincaré sphere
* Low-, medium-, and high-precision constellation plots
* Connection and stream status

Graphs use automatic video-presentation synchronization when the browser
supports `HTMLVideoElement.requestVideoFrameCallback`. The **Auto** mode uses
the presented frame's DOM `captureTime` and a bounded NTP-style WebSocket clock
estimate to match complete application-owned telemetry frames by source
timestamp. Some relays/browsers omit a usable capture time; when a valid DOM
`receiveTime` is available, **Estimated** mode matches video receive time to
the local WebSocket arrival time of each complete telemetry packet. Estimated
mode is transport-relative and does not claim source-capture precision. If
neither time is usable, the tab is backgrounded, or a packet misses the bounded
hold window, **Fallback** continues rendering recent telemetry. There is no
manual A/V delay control. The synchronization layer does not change telemetry
values, normalization, or application frame IDs.

If a transient WebRTC peer or signaling failure interrupts the video stream, the viewer automatically requests recovery with bounded backoff. Intentional host camera stops remain inactive until the host starts the camera again.

---

## Remote viewing with Tailscale

The application binds locally by default.

For private remote demonstrations, Tailscale Serve can expose the application over authenticated HTTPS without opening the server directly to the public internet.

Install and authenticate Tailscale, then run the application normally:

```bash
npm run build
npm run server
```

In another terminal:

```bash
tailscale serve --bg http://127.0.0.1:8181
```

Inspect the generated address with:

```bash
tailscale serve status
```

Viewers can then use the HTTPS Tailscale URL supplied by the presenter.

When finished:

```bash
tailscale serve reset
```

Access can be further restricted using your organisation's Tailscale access-control policy.

---

## Development

Start the Vite development server:

```bash
npm run dev
```

Run the production build:

```bash
npm run build
```

Run linting:

```bash
npm run lint
```

### Automated tests

```bash
npm test
```

Current test suite:

Run `npm test` to execute the complete test suite; it includes deterministic
automatic A/V synchronization tests in addition to the server and ingest
tests below.

The automated tests cover areas including:

* Live file tailing and incremental writes
* Incomplete and malformed experiment rows
* File truncation and rotation
* Bounded buffering under fast writers
* Static serving and traversal protection
* Host and viewer authentication
* IP allowlists
* Telemetry protocol validation
* WebSocket signalling validation
* Native WebRTC forwarding
* Host recovery and grace-period expiry
* Heartbeat-based client eviction
* Password-attempt limiting
* Late-viewer telemetry snapshots
* Backpressure behaviour
* Stream restart rate limiting
* Reconnection backoff
* High-frequency telemetry validation
* Automatic exact/estimated video-telemetry timing, bounded queues, clock-offset estimation, and fallback behaviour

---

## Platform setup

### Windows

Install:

* Node.js
* Python 3
* Visual Studio C++ Build Tools

For example:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --force --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools"
winget install Python.Python.3.11
winget install OpenJS.NodeJS.LTS
```

Ensure camera access is enabled under:

```text
Settings → Privacy & Security → Camera
```

### macOS

```bash
brew install node python
xcode-select --install
```

Grant your browser camera access under:

```text
System Settings → Privacy & Security → Camera
```

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y curl build-essential python3 pkg-config
```

Install a supported Node.js release before running `npm install`.

### Fedora / RHEL

```bash
sudo dnf install -y gcc-c++ make python3 pkgconf-pkg-config nodejs
```

### Arch Linux / Manjaro

```bash
sudo pacman -S base-devel python pkgconf nodejs npm
```

### Nix / NixOS

The repository includes `flake.nix`.

With `direnv`:

```bash
direnv allow
```

The development environment provisions Node.js, Python and the required native-build dependencies.

---

## Troubleshooting

### `EADDRINUSE` on port 8181

Another process is already listening on the application port.

Linux/macOS:

```bash
lsof -ti:8181
```

Terminate the old process before restarting the server.

### `@roamhq/wrtc` installation fails

Ensure native compiler tooling and Python are installed.

On macOS:

```bash
xcode-select --install
```

On Debian/Ubuntu:

```bash
sudo apt install build-essential python3 pkg-config
```

On Windows, install the Visual Studio C++ Build Tools.

### Host browser refreshes or disconnects

The server keeps the session alive during a short host-disconnection grace period.

Return to the application and reclaim the Host role using the original `HOST_TOKEN`.

Connected viewers can remain in the session during recovery.

### Viewer video is black or disconnected

Verify that:

* The Host camera is running
* Browser camera permissions are allowed
* The Viewer is still connected

Transient peer failures are retried automatically. If automatic recovery eventually fails, verify the host camera is still running and reconnect the viewer if needed.

### Live ingest reports an error

Check that:

1. The directory exists.
2. All eight required files exist.
3. Their filenames match exactly.
4. The server process has permission to read them.

If an experiment has been restarted or its files replaced, restart live ingest so the cursors can realign.

---

## Technology

**Frontend**

React · Vite · Three.js · Chart.js

**Server**

Node.js · WebSocket (`ws`) · WebRTC (`@roamhq/wrtc`)

**Networking**

WebSocket telemetry/signalling · WebRTC media forwarding · optional Tailscale HTTPS access

---

## Research context

This software was developed for research demonstration of fixed-precision effects in State-of-Polarization sensing using coherent optical communication systems.

Developed for the **Aston Institute of Photonics Technologies at Aston University, Birmingham, United Kingdom**.

Dashboard developed by **Rayyan Parkar** for presentation at the **Optical Fiber Communication (OFC) Conference**.
