// --- DRAWING ENGINE ---
    const canvas = document.getElementById('pad');
    const ctx = canvas.getContext('2d');
    const canvasContainer = document.getElementById('canvasContainer');
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let currentColor = '#000000';
    let isDrawing = false;
    let activeTool = 'pencil'; // pencil, eraser, fill, picker, line, rect, oval
    
    let startX = 0;
    let startY = 0;
    let dragStartImgData = null;

    let isLiveMode = false;
    let liveQueue = [];
    let isSendingLive = false;
    let lastPos = null;

    function hexToRGB565(hex) {
        let r = 0, g = 0, b = 0;
        if (hex.startsWith('#')) {
            r = parseInt(hex.slice(1, 3), 16);
            g = parseInt(hex.slice(3, 5), 16);
            b = parseInt(hex.slice(5, 7), 16);
        }
        return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
    }
    
    async function processLiveQueue() {
        if (!port || isSendingLive || liveQueue.length === 0) return;
        isSendingLive = true;
        try {
            const writer = port.writable.getWriter();
            while(liveQueue.length > 0) {
                const { buffer, code } = liveQueue.shift();
                await writer.write(buffer);
                
                // Add a small 2ms delay to prevent Arduino's 64-byte serial buffer from overflowing
                await new Promise(r => setTimeout(r, 2));

                const consoleDiv = document.getElementById('codeConsole');
                if (consoleDiv) {
                    const line = document.createElement('div');
                    line.textContent = code;
                    consoleDiv.appendChild(line);
                    consoleDiv.scrollTop = consoleDiv.scrollHeight;
                }
            }
            writer.releaseLock();
        } catch (e) {
            console.error("Live sync error", e);
        }
        isSendingLive = false;
    }

    function sendLiveCommand(type, args, codeString) {
        if (!isLiveMode || !port) return;
        
        let buffer;
        const color565 = args.color ? hexToRGB565(args.color) : 0xFFFF;
        
        if (type === 'L') {
            buffer = new Uint8Array([
                'L'.charCodeAt(0),
                (args.x1 >> 8) & 0xFF, args.x1 & 0xFF,
                (args.y1 >> 8) & 0xFF, args.y1 & 0xFF,
                (args.x2 >> 8) & 0xFF, args.x2 & 0xFF,
                (args.y2 >> 8) & 0xFF, args.y2 & 0xFF,
                (color565 >> 8) & 0xFF, color565 & 0xFF
            ]);
        } else if (type === 'C') {
            buffer = new Uint8Array([
                'C'.charCodeAt(0),
                (args.x >> 8) & 0xFF, args.x & 0xFF,
                (args.y >> 8) & 0xFF, args.y & 0xFF,
                args.r & 0xFF,
                (color565 >> 8) & 0xFF, color565 & 0xFF
            ]);
        } else if (type === 'R' || type === 'F') {
            buffer = new Uint8Array([
                type.charCodeAt(0),
                (args.x >> 8) & 0xFF, args.x & 0xFF,
                (args.y >> 8) & 0xFF, args.y & 0xFF,
                (args.w >> 8) & 0xFF, args.w & 0xFF,
                (args.h >> 8) & 0xFF, args.h & 0xFF,
                (color565 >> 8) & 0xFF, color565 & 0xFF
            ]);
        } else if (type === 'E') {
            buffer = new Uint8Array([
                'E'.charCodeAt(0),
                (color565 >> 8) & 0xFF, color565 & 0xFF
            ]);
        }
        
        if (buffer) {
            liveQueue.push({ buffer, code: codeString });
            processLiveQueue();
        }
    }

    function sendThickLineLive(x1, y1, x2, y2, thickness, colorHex) {
        if (!isLiveMode || !port) return;
        const r = Math.max(1, Math.floor(thickness / 2));
        
        if (r <= 1) {
            sendLiveCommand('L', {x1: Math.floor(x1), y1: Math.floor(y1), x2: Math.floor(x2), y2: Math.floor(y2), color: colorHex}, `tft.drawLine(${Math.floor(x1)}, ${Math.floor(y1)}, ${Math.floor(x2)}, ${Math.floor(y2)}, 0x${hexToRGB565(colorHex).toString(16).toUpperCase().padStart(4,'0')});`);
            return;
        }

        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const step = Math.max(1, r / 2);
        const steps = Math.max(1, Math.ceil(distance / step));
        
        for (let i = 0; i <= steps; i++) {
            const t = steps === 0 ? 0 : i / steps;
            const cx = Math.floor(x1 + dx * t);
            const cy = Math.floor(y1 + dy * t);
            sendLiveCommand('C', {x: cx, y: cy, r: r, color: colorHex}, `tft.fillCircle(${cx}, ${cy}, ${r}, 0x${hexToRGB565(colorHex).toString(16).toUpperCase().padStart(4,'0')});`);
        }
    }

    // --- UNDO/REDO ENGINE ---
    let undoStack = [];
    let redoStack = [];

    function saveState() {
        if (undoStack.length >= 30) {
            undoStack.shift();
        }
        undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        redoStack = []; // Clear redo stack on new action
        updateUndoRedoButtons();
    }

    function undo() {
        if (undoStack.length > 1) {
            const currentState = undoStack.pop();
            redoStack.push(currentState);
            
            const prevState = undoStack[undoStack.length - 1];
            ctx.putImageData(prevState, 0, 0);
            
            if (isLiveMode && document.getElementById('btnUpload')) {
                document.getElementById('btnUpload').click();
            }
        }
        updateUndoRedoButtons();
    }

    function redo() {
        if (redoStack.length > 0) {
            const nextState = redoStack.pop();
            undoStack.push(nextState);
            ctx.putImageData(nextState, 0, 0);
            
            if (isLiveMode && document.getElementById('btnUpload')) {
                document.getElementById('btnUpload').click();
            }
        }
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        if (btnUndo) btnUndo.disabled = undoStack.length <= 1;
        if (btnRedo) btnRedo.disabled = redoStack.length === 0;
    }

    // --- CANVAS ZOOM & SCALING SYSTEM ---
    function initializeCanvas(w, h) {
        canvas.width = w;
        canvas.height = h;
        
        const maxWidth = 720;
        const maxHeight = 480;
        
        const scale = Math.min(maxWidth / w, maxHeight / h);
        const targetWidth = w * scale;
        const targetHeight = h * scale;
        
        canvasContainer.style.width = `${targetWidth}px`;
        canvasContainer.style.height = `${targetHeight}px`;
        
        // Clear canvas to white
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        
        // Reapply current draw state
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = strokeSlider.value;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        // Reset undo/redo stacks
        undoStack = [];
        redoStack = [];
        saveState(); // Save baseline blank state
        
        // Update footer info
        const resDisplay = document.getElementById('resolutionDisplay');
        if (resDisplay) resDisplay.textContent = `${w}x${h}`;
        document.getElementById('pos-x').textContent = '0';
        document.getElementById('pos-y').textContent = '0';
        
        // Update zoom percentage display
        const zoomText = document.getElementById('zoomText');
        if (zoomText) zoomText.textContent = `ZOOM: ${Math.round(scale * 100)}%`;
    }

    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (canvas.width / rect.width),
            y: (e.clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    // --- MOUSE DRAWING ACTIONS ---
    canvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        startX = pos.x;
        startY = pos.y;
        lastPos = pos;
        isDrawing = true;
        
        if (activeTool === 'pencil' || activeTool === 'eraser') {
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            // Draw initial point instantly
            ctx.strokeStyle = activeTool === 'pencil' ? currentColor : '#ffffff';
            ctx.lineWidth = strokeSlider.value;
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            const colorToSend = activeTool === 'pencil' ? currentColor : '#ffffff';
            sendThickLineLive(pos.x, pos.y, pos.x, pos.y, strokeSlider.value, colorToSend);
        } else if (activeTool === 'fill') {
            floodFill(pos.x, pos.y, currentColor);
            if (isLiveMode && document.getElementById('btnUpload')) {
                document.getElementById('btnUpload').click();
            }
            isDrawing = false;
        } else if (activeTool === 'picker') {
            pickColor(pos.x, pos.y);
            isDrawing = false;
        } else {
            // Shapes line, rect, oval
            dragStartImgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const pos = getMousePos(e);
        
        document.getElementById('pos-x').textContent = Math.floor(pos.x);
        document.getElementById('pos-y').textContent = Math.floor(pos.y);

        if (!isDrawing) return;

        if (activeTool === 'pencil') {
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = strokeSlider.value;
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            sendThickLineLive(lastPos.x, lastPos.y, pos.x, pos.y, strokeSlider.value, currentColor);
            lastPos = pos;
        } else if (activeTool === 'eraser') {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = strokeSlider.value;
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            sendThickLineLive(lastPos.x, lastPos.y, pos.x, pos.y, strokeSlider.value, '#ffffff');
            lastPos = pos;
        } else if (dragStartImgData) {
            // Shapes preview engine
            ctx.putImageData(dragStartImgData, 0, 0);
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = strokeSlider.value;
            ctx.fillStyle = 'transparent';
            
            if (activeTool === 'line') {
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
            } else if (activeTool === 'rect') {
                ctx.beginPath();
                ctx.rect(startX, startY, pos.x - startX, pos.y - startY);
                ctx.stroke();
            } else if (activeTool === 'oval') {
                ctx.beginPath();
                const rx = Math.abs(pos.x - startX) / 2;
                const ry = Math.abs(pos.y - startY) / 2;
                const cx = Math.min(startX, pos.x) + rx;
                const cy = Math.min(startY, pos.y) + ry;
                ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
                ctx.stroke();
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (isDrawing) {
            const pos = getMousePos(e);
            if (activeTool === 'line' || activeTool === 'rect' || activeTool === 'oval') {
                if (isLiveMode && document.getElementById('btnUpload')) {
                     document.getElementById('btnUpload').click();
                }
            }
            isDrawing = false;
            dragStartImgData = null;
            saveState();
        }
    });

    // --- FLOOD FILL ALGORITHM (Paint Bucket) ---
    function floodFill(startX, startY, fillColor) {
        startX = Math.floor(startX);
        startY = Math.floor(startY);
        const w = canvas.width;
        const h = canvas.height;
        
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        
        const startIdx = (startY * w + startX) * 4;
        const startR = data[startIdx];
        const startG = data[startIdx + 1];
        const startB = data[startIdx + 2];
        const startA = data[startIdx + 3];
        
        // Parse active color hex to RGB values
        let r = 0, g = 0, b = 0;
        if (fillColor.startsWith('#')) {
            r = parseInt(fillColor.slice(1, 3), 16);
            g = parseInt(fillColor.slice(3, 5), 16);
            b = parseInt(fillColor.slice(5, 7), 16);
        }
        
        // Return immediately if target and fill color are the same
        if (startR === r && startG === g && startB === b && startA === 255) {
            return;
        }
        
        const queue = [];
        queue.push(startX, startY);
        
        const visited = new Uint8Array(w * h);
        visited[startY * w + startX] = 1;
        
        let head = 0;
        while (head < queue.length) {
            const cx = queue[head++];
            const cy = queue[head++];
            
            const idx = (cy * w + cx) * 4;
            
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
            
            const dirs = [
                [cx + 1, cy],
                [cx - 1, cy],
                [cx, cy + 1],
                [cx, cy - 1]
            ];
            
            for (const [nx, ny] of dirs) {
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    const npos = ny * w + nx;
                    if (!visited[npos]) {
                        const nidx = npos * 4;
                        if (Math.abs(data[nidx] - startR) < 15 &&
                            Math.abs(data[nidx + 1] - startG) < 15 &&
                            Math.abs(data[nidx + 2] - startB) < 15 &&
                            Math.abs(data[nidx + 3] - startA) < 15) {
                            
                            visited[npos] = 1;
                            queue.push(nx, ny);
                        }
                    }
                }
            }
        }
        
        ctx.putImageData(imgData, 0, 0);
        saveState();
    }

    // --- EYEDROPPER COLOR PICKER ---
    function pickColor(x, y) {
        x = Math.floor(x);
        y = Math.floor(y);
        if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return;
        
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        const r = pixel[0].toString(16).padStart(2, '0');
        const g = pixel[1].toString(16).padStart(2, '0');
        const b = pixel[2].toString(16).padStart(2, '0');
        const hex = `#${r}${g}${b}`;
        
        updateColor(hex);
        setTool('pencil');
    }

    function updateColor(color) {
        currentColor = color;
        
        // Active color indicator background update
        const indicator = document.getElementById('activeColorIndicator');
        if (indicator) indicator.style.backgroundColor = color;
        
        // Highlight matching swatch, if any
        document.querySelectorAll('.color-swatch').forEach(swatch => {
            if (swatch.dataset.color.toLowerCase() === color.toLowerCase()) {
                swatch.classList.add('selected-color');
            } else {
                swatch.classList.remove('selected-color');
            }
        });
        
        // Set custom color input value
        const customPicker = document.getElementById('customColorPicker');
        if (customPicker) customPicker.value = color;
    }

    // --- MS PAINT TOOL CONTROLLER ---
    function setTool(toolId) {
        activeTool = toolId;
        
        // Remove style highlights from all tool buttons
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('bg-blue-600/30', 'text-blue-400', 'border-blue-500/30');
            btn.classList.add('hover:bg-[#2d2d2d]', 'text-gray-300', 'border-transparent');
        });
        
        // Format and highlight the selected button
        const activeBtn = document.getElementById('tool' + toolId.charAt(0).toUpperCase() + toolId.slice(1));
        if (activeBtn) {
            activeBtn.classList.remove('hover:bg-[#2d2d2d]', 'text-gray-300', 'border-transparent');
            activeBtn.classList.add('bg-blue-600/30', 'text-blue-400', 'border-blue-500/30');
        }
    }

    // Assign tool selections to buttons
    const tools = ['pencil', 'fill', 'eraser', 'picker', 'line', 'rect', 'oval'];
    tools.forEach(tool => {
        const btn = document.getElementById('tool' + tool.charAt(0).toUpperCase() + tool.slice(1));
        if (btn) {
            btn.addEventListener('click', () => setTool(tool));
        }
    });

    // Clear Canvas
    document.getElementById('toolClear').addEventListener('click', () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        saveState();
        sendLiveCommand('E', {color: '#ffffff'}, `tft.fillScreen(0xFFFF);`);
    });

    // Stroke weight slider
    const strokeSlider = document.getElementById('strokeSlider');
    const strokeDisplay = document.getElementById('strokeDisplay');
    strokeSlider.addEventListener('input', (e) => {
        ctx.lineWidth = e.target.value;
        strokeDisplay.textContent = e.target.value + 'px';
    });

    // Color Swatches
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            updateColor(e.target.dataset.color);
        });
    });

    // Custom Color picker input
    const customPicker = document.getElementById('customColorPicker');
    customPicker.addEventListener('input', (e) => {
        updateColor(e.target.value);
    });

    // Undo & Redo buttons
    document.getElementById('btnUndo').addEventListener('click', undo);
    document.getElementById('btnRedo').addEventListener('click', redo);

    // Undo/Redo keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
        }
    });

    // PNG download save option
    document.getElementById('btnDownload').addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `paint_drawing_${canvas.width}x${canvas.height}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });

    // --- THE COMPRESSION ALGORITHM & UPLOAD ENGINE ---
    let port;
    const btnConnect = document.getElementById('btnConnect');
    const btnUpload = document.getElementById('btnUpload');
    const statusDot = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');

    btnConnect.addEventListener('click', async () => {
        try {
            port = await navigator.serial.requestPort();
            await port.open({ baudRate: 115200 });
            
            // Try to auto-detect resolution
            const writer = port.writable.getWriter();
            const reader = port.readable.getReader();
            
            // Send identify command
            await writer.write(new Uint8Array(['I'.charCodeAt(0)]));
            
            let buffer = [];
            let foundHeader = false;
            
            // 1 second timeout for handshake response
            const handshakeTimeout = setTimeout(() => {
                reader.releaseLock();
                writer.releaseLock();
                onConnected(); // Fallback to current size if timeout
            }, 1000);

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    for (let j = 0; j < value.length; j++) {
                        if (!foundHeader) {
                            if (value[j] === 'I'.charCodeAt(0)) {
                                foundHeader = true;
                                buffer.push(value[j]);
                            }
                        } else {
                            buffer.push(value[j]);
                            if (buffer.length === 5) break;
                        }
                    }
                }
                if (buffer.length === 5) break;
            }
            
            clearTimeout(handshakeTimeout);
            
            if (buffer.length === 5 && buffer[0] === 'I'.charCodeAt(0)) {
                const w = (buffer[1] << 8) | buffer[2];
                const h = (buffer[3] << 8) | buffer[4];
                reader.releaseLock();
                writer.releaseLock();
                initializeCanvas(w, h);
            } else {
                reader.releaseLock();
                writer.releaseLock();
            }
            
            onConnected();
            
        } catch (err) {
            console.error(err);
            alert("Connection failed! Close the Arduino IDE Serial Monitor.");
        }
    });

    function onConnected() {
        statusDot.classList.replace('bg-red-500', 'bg-green-500');
        statusDot.classList.add('animate-pulse');
        statusText.textContent = `Connected`;
        statusText.classList.replace('text-on-surface-variant', 'text-green-500');
        
        btnConnect.classList.add('hidden');
        btnUpload.classList.remove('hidden');
        btnUpload.classList.add('flex');
    }

    btnUpload.addEventListener('click', async () => {
        if (!port) return;
        
        const originalText = btnUpload.innerHTML;
        btnUpload.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">sync</span> ZIPPING...`;
        
        try {
            const writer = port.writable.getWriter();
            const reader = port.readable.getReader();
            
            // 1. Tell Arduino to prepare for compressed data stream
            await writer.write(new Uint8Array(['S'.charCodeAt(0)]));
            
            // 2. Compress the Canvas using Run-Length Encoding (RLE)
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const runs = [];
            let currentRGB = null;
            let count = 0;

            for (let i = 0; i < imgData.length; i += 4) {
                let r = imgData[i], g = imgData[i+1], b = imgData[i+2];
                let rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);

                if (currentRGB === null) {
                    currentRGB = rgb565;
                    count = 1;
                } else if (currentRGB === rgb565 && count < 65535) { // 16-bit max count limit
                    count++;
                } else {
                    runs.push({count: count, color: currentRGB});
                    currentRGB = rgb565;
                    count = 1;
                }
            }
            runs.push({count: count, color: currentRGB});

            btnUpload.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">bolt</span> SENDING...`;

            // 3. Serialize and Send in chunks of 16 runs (64 bytes)
            const chunkSize = 16;
            for (let i = 0; i < runs.length; i += chunkSize) {
                const chunk = runs.slice(i, i + chunkSize);
                const buffer = new Uint8Array(chunk.length * 4);
                let bIdx = 0;
                for (let run of chunk) {
                    buffer[bIdx++] = (run.count >> 8) & 0xFF;
                    buffer[bIdx++] = run.count & 0xFF;
                    buffer[bIdx++] = (run.color >> 8) & 0xFF;
                    buffer[bIdx++] = run.color & 0xFF;
                }
                
                await writer.write(buffer);

                // Wait for the ACK 'K' from Arduino
                let ackReceived = false;
                while (!ackReceived) {
                    const { value, done } = await reader.read();
                    if (done) {
                        throw new Error("Serial port closed while waiting for ACK");
                    }
                    if (value) {
                        for (let j = 0; j < value.length; j++) {
                            if (value[j] === 'K'.charCodeAt(0)) {
                                ackReceived = true;
                                break;
                            }
                        }
                    }
                }
            }
            
            writer.releaseLock();
            reader.releaseLock();
            
            // Success indicator
            btnUpload.innerHTML = `<span class="material-symbols-outlined text-[16px]">check</span> DONE!`;
            setTimeout(() => {
                btnUpload.innerHTML = originalText;
            }, 3000);

        } catch (err) {
            console.error(err);
            alert("Upload interrupted.");
            btnUpload.innerHTML = originalText;
        }
    });

    const btnLive = document.getElementById('btnLive');
    if (btnLive) {
        btnLive.addEventListener('click', () => {
            isLiveMode = !isLiveMode;
            if (isLiveMode) {
                btnLive.classList.replace('bg-gray-700', 'bg-red-600');
                btnLive.classList.replace('hover:bg-gray-600', 'hover:bg-red-700');
                btnLive.classList.replace('border-gray-600', 'border-red-500');
                btnLive.innerHTML = `<span class="material-symbols-outlined text-[14px] animate-pulse" id="liveIcon">radio_button_checked</span> LIVE: ON`;
            } else {
                btnLive.classList.replace('bg-red-600', 'bg-gray-700');
                btnLive.classList.replace('hover:bg-red-700', 'hover:bg-gray-600');
                btnLive.classList.replace('border-red-500', 'border-gray-600');
                btnLive.innerHTML = `<span class="material-symbols-outlined text-[14px]" id="liveIcon">radio_button_unchecked</span> LIVE: OFF`;
            }
        });
    }

    // --- INITIALIZE STARTUP STATE ---
    initializeCanvas(480, 320);
    updateColor('#000000');
