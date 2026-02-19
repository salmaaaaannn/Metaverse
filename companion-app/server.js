const WebSocket = require('ws');
const { spawn } = require('child_process');

const wss = new WebSocket.Server({ port: 8080 });

console.log("==================================================");
console.log("   SkyOffice Companion (PowerShell Edition)");
console.log("   Running on port 8080");
console.log("   Keep this window open!");
console.log("==================================================");

// 1. Spawn a persistent PowerShell instance
const ps = spawn('powershell.exe', ['-Command', '-']);

// 2. Load C# assemblies for mouse control into PowerShell
// This lets us call Windows API directly without installing ANY plugins.
const initScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name "Win32Mouse" -Namespace Win32Functions
`;
ps.stdin.write(initScript + '\n');

// 3. Handle Browser Connection
wss.on('connection', function connection(ws) {
  console.log('>> Browser Connected!');

  ws.on('message', function incoming(message) {
    try {
      const data = JSON.parse(message);

      // --- HANDLE MOUSE MOVE ---
      if (data.type === 'mousemove') {
        // Assume standard 1080p for scaling (adjust if your screen is 4k)
        // If you want perfect mapping, we can make the browser send its size later.
        const width = 1920; 
        const height = 1080; 
        
        const x = Math.floor(data.x * width);
        const y = Math.floor(data.y * height);
        
        // Move mouse via .NET
        const cmd = `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})\n`;
        ps.stdin.write(cmd);
      }

      // --- HANDLE CLICK ---
      if (data.type === 'click') {
        // 0x02 = LeftDown, 0x04 = LeftUp
        const cmd = `[Win32Functions.Win32Mouse]::mouse_event(0x02, 0, 0, 0, 0); [Win32Functions.Win32Mouse]::mouse_event(0x04, 0, 0, 0, 0)\n`;
        ps.stdin.write(cmd);
      }

      // --- HANDLE KEYS ---
      if (data.type === 'keypress') {
        // SendKeys handles typing
        // We wrap single letters in {} just in case, but usually needed for special keys
        let key = data.key;
        if (key.length > 1) key = `{${key.toUpperCase()}}`; 
        
        // Escape special chars for PowerShell string
        if (key === '"') key = '\"';
        
        const cmd = `[System.Windows.Forms.SendKeys]::SendWait("${key}")\n`;
        ps.stdin.write(cmd);
      }

    } catch (err) {
      console.error("Error:", err);
    }
  });
});