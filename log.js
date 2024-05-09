const fs = require('fs');
const path = require('path');

const fgWhite = '\u001B[1;37;44m';
const reset = '\u001B[0m';
const red = '\u001B[31;1m';
const yellow = '\u001B[33;1m';
const saveCursor = '\u001B[s';
const moveHome = '\u001B[H';
const restoreCursor = '\u001B[u';
const lineUp = '\u001B[A';
const lineEnd = '\u001B[999C';
const lineLeft = '\u001B[D';


var logfile = path.join(process.cwd(), 'mudproxy.log');

//
// debug logging
//
var config = {
    '/': true, // Default enable all logging
    '/messaging/incoming/data': false, // reduces spam
};
var disk = config;

function isEnabled(cfg, path) {
    const parts = path.split('/').filter(Boolean);

    for (let i = parts.length; i >= 0; i--) {
        const currentPath = '/' + parts.slice(0, i).join('/');

        if (cfg[currentPath] !== undefined) {
            return cfg[currentPath];
        }
    }
    return false;
}  

var lastMessage = "";
var repeated = 1;

function write(path, text) {
    if (isEnabled(config, path)) {
        let replaced = text.replace(/\*([^*]+)\*/g, `${yellow}$1${reset}`);
        replaced = replaced.replace(/\!([^*]+)\!/g, `${red}$1${reset}`);
        if (replaced == lastMessage) {
            repeated++;
            process.stdout.write(saveCursor + lineUp + lineEnd + lineLeft.repeat(3) + repeated + restoreCursor);
        } else {
            repeated = 1;
            lastMessage = replaced;
            console.log(fgWhite + `[${path}]:` + reset + ` ${replaced}`);
        }
    }

    if (!isEnabled(disk, path)) return;

    fs.appendFile(logfile, `[${path}]: ${text}` + "\r\n", err => {
        if (err) throw err;

        fs.stat(logfile, (err, stats) => {
            if (err) throw err;

            const fileSizeInBytes = stats.size;
            const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);

            if (fileSizeInMegabytes > 50) {
                // Delete first 1000 lines
                const data = fs.readFileSync(logfile, 'utf8').split('\n').slice(1000).join('\n');
                fs.writeFileSync(logfile, data);
            }
        });
    });
}

function setLog(c) {
    config = c;
    setDisk(c);
}

function setDisk(c) {
    disk = c;
}


module.exports = { setLog, setDisk, write };