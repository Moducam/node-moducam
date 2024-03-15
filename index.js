const fs = require('fs');
const ini = require('ini');
const { spawn, exec } = require('child_process');
const WebSocket = require("ws");

let config;
let pythonPath;
let pythonProcess;
let wss;
let configPath
let arglist;

exports.startModucam = function(moducamPath, confPath, videoDir) {
    arglist = [moducamPath];
    arglist.push("-c", confPath);
    arglist.push("--pipe");
    arglist.push(videoDir);

    config = ini.parse(fs.readFileSync(confPath, 'utf-8'));
    configPath = confPath;

    exec('which python3', (error, stdout, stderr) => {
        pythonPath = stdout.trim()
        pythonProcess = spawn(pythonPath, arglist);
        setProcessEvents();
    });
}

exports.startWebSocketServer = function(httpServer) {
    wss = new WebSocket.Server({
        server: httpServer
    });

    wss.on("connection", function connection(ws) {
        console.log("Client conneted to websocket");
    });
}

exports.restart = function() {
    if (pythonProcess) {
        pythonProcess.kill('SIGINT');
    } else {
        pythonProcess = spawn(pythonPath, arglist);
        setProcessEvents();
    }
}

function setProcessEvents() {
    let imgBuf = Buffer.alloc(0);

    pythonProcess.on('close', (code, signal) => {
        console.log("Moducam exited with code " + code);
        pythonProcess = spawn(pythonPath, arglist);
        setProcessEvents();
    });

    pythonProcess.stdout.on('data', (data) => {
        imgBuf = Buffer.concat([imgBuf, data]);

        // check for JPEG's EOF marker
        if (data.length >= 2 &&
            data[data.length - 2] === 0xFF &&
            data[data.length - 1] === 0xD9) {
            if (wss) {
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(imgBuf, {binary : true});
                    }
                });
            }
            imgBuf = Buffer.alloc(0);
        }
    });
    
    pythonProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });
}

exports.updateConfigFile = function(new_configs) {
    for (const key in config) {
        for (const property in config[key]) {
            if (new_configs[key].hasOwnProperty(property)) {
                if (property === "zone_points") {
                    new_configs[key][property] = convertPointsFromJson(new_configs[key][property]);
                }
                config[key][property] = new_configs[key][property]
            }
        }
    }

    fs.writeFileSync(configPath, ini.stringify(config));
    
    exports.restart();
}

exports.getConfig = function() {
    const converted = JSON.parse(JSON.stringify(config));
    converted["Zone"]["zone_points"] = convertPointsToJson(config["Zone"]["zone_points"])
    return converted
}

function convertPointsFromJson(json) {
    return json.map(point => `(${point.x}, ${point.y})`).join(", ");
}

function convertPointsToJson(str) {
    const points = str.split("), ").map(point => 
        point.replace(/\(|\)/g, "")
        .split(", ")
        .map(Number)
    );
    
    const zonePoints = points.map(([x, y]) => ({ x, y }));
      
    return zonePoints;
}