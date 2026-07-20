# Skill: Debugging FFmpeg & Streaming Pipelines

This skill provides step-by-step guidelines and diagnostics to troubleshoot, debug, and optimize FFmpeg transcoding and HLS streaming pipelines inside the Media Center.

---

## 📋 Overview

The Media Center spawns external `ffmpeg` processes to handle live security camera transcoding (RTSP to HLS) and media format conversions. If not managed properly, these processes can become orphaned and consume 100% of host CPU/RAM resources.

## 🛠️ Step-by-Step Diagnostics

### Step 1: Identify Active Processes
Search for orphaned or active FFmpeg processes running in the background:
```bash
# List all running ffmpeg processes with detail
ps aux | grep ffmpeg
```

### Step 2: Correlate Socket Connections
Check if the spawned processes match the current WebSocket connections:
```bash
# Check port 5555 connections
netstat -an | grep 5555
```

### Step 3: Inspect Logs for Core Failures
Look at the Node container stdout logs for FFmpeg pipe errors:
```bash
docker-compose --project-name="blackbirdmc" logs --tail 100 blackbirdmc_node | grep -i ffmpeg
```

---

## 💡 Code Patterns & Best Practices

### 1. Safe Process Spawn & Clean Up
Always bind to the `error` and `close`/`end` event listeners to prevent orphaned processes when spawning FFmpeg:

```javascript
const { spawn } = require('child_process');

function startTranscoding(rtspUrl, outputPath) {
    const ffmpeg = spawn('ffmpeg', [
        '-rtsp_transport', 'tcp',
        '-i', rtspUrl,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '28',
        '-g', '50',
        '-hls_time', '4',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments',
        outputPath
    ]);

    // Handle standard error stream (FFmpeg diagnostics)
    ffmpeg.stderr.on('data', (data) => {
        // Log critical issues only to avoid stdout flooding
        if (data.toString().includes('Error')) {
            console.error(`[FFmpeg Error]: ${data.toString().trim()}`);
        }
    });

    // Ensure clean-up on error
    ffmpeg.on('error', (err) => {
        console.error('[FFmpeg Process Error]:', err);
        killProcess(ffmpeg);
    });

    // Clean-up when process terminates
    ffmpeg.on('close', (code) => {
        console.log(`[FFmpeg Process Closed] code: ${code}`);
    });

    return ffmpeg;
}

function killProcess(proc) {
    if (proc) {
        try {
            proc.kill('SIGKILL');
            console.log('[FFmpeg Process] Forcefully terminated.');
        } catch (e) {
            console.error('[FFmpeg Process] Failed to kill:', e.message);
        }
    }
}
```

### 2. Client Disconnect Clean Up
When a client closes the streaming page or disconnects from the WebSocket, immediately kill the associated FFmpeg process:

```javascript
// Inside express router or socket handler
req.on('close', () => {
    console.log('[Client Disconnected] Terminating streaming feed...');
    killProcess(activeFfmpegProcess);
});
```

---

## ❓ Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **CPU usage reaches 100%** | Orphaned FFmpeg processes. | Run `pkill -9 ffmpeg` on the host, and ensure all `.on('close')` listeners are correctly configured. |
| **HLS Stream loading forever** | Codec mismatch or bad RTSP credentials. | Check connection by running: `ffmpeg -rtsp_transport tcp -i rtsp://user:pass@ip -t 5 -c copy test.mp4` |
| **Out of disk space warning** | HLS `.ts` segments are not being deleted. | Ensure the `-hls_flags delete_segments` parameter is specified in the command arguments. |
