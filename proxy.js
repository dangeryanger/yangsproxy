// proxy.js
const fs = require('fs');
const path = require('path');
const version = "{versionstring}";
console.log(`Yangs Proxy v${version}`);

var log = require('./log.js');
const TelnetProxy = require('./telnet.js');
const Configuration = require('./config.js');
const Player = require('./player.js');
const { clearInterval } = require('timers');
const discord = require('./discord.js');

const ansiCodes = /\u001B\[([0-9;]*[JKmsuHfABCD]|[0-9;?]*h)/g;
const statusLine = /\[HP=/;

var command = "";
var proxy;
var lastStatusLine;
var lastLine;
var botResponse;
var bannerTimer;
var midRoundTimer;
var timers;
var mobs;
var queue = [];
var userIsTyping = false;
var firstStatus = false;
var seen = [];
var arrayNum = 0;
var arrayInterval;
var enabled = true;
var deadInterval;

deadInterval = setInterval(() => {
    if (player?.InGame && proxy) {
        proxy.kill();
    }
}, 5000);

//
// read YAML file name or default to config.yaml
//
var filename = process.argv[2] || 'config.yaml';
filename = path.join(process.cwd(), filename);

// Check if the file exists
if (!fs.existsSync(filename)) {
    console.error(`Error: File ${filename} does not exist.`);
    return 2;
}

//
// load the config
//
const config = new Configuration(filename);

//
// PLAYER
//
const player = new Player();

player.on('combatOff', () => clearTimeout('midRoundTimer'));
player.on('playerSwing', () => setMidRoundTimer());
player.on('mobDied', () => {
    config.set('mobs', config.state.mobs ? config.state.mobs - 1 : 0);
    raiseEvent('mobDied')
});
player.on('statusLine', () => {
    config.set('MA%', player.MAPercent);
    config.set('HP%', player.HPPercent);
});

//
// check for spells to cast runs once every 4 seconds
//
setInterval(() => {
    if (!enabled || !player.InGame || !firstStatus || !config.options.spells) return;
    
    config.options.spells?.forEach((spell) => {
        player.queueSpellNotInUse(spell);
    });

    // attempt to cast it. it will get removed from the queue when a matching
    // start is found
    if (player.InGame && !userIsTyping) {
        let spell = player.nextQueuedSpell();

        if (player.shouldCastSpell(spell)) {
            log.write('/spells', `attempting to cast *${spell.name ? spell.name : spell.start}*`);
            processEvent(spell.command);
        }
    }
}, 4000);

function setTimers() {
    // clear all current timers
    timers?.forEach((timer) => {
        log.write('/timers/clear', `clearing timer *${JSON.stringify(timer.do)}*`);
        clearInterval(timer);
    });
    timers = [];
    
    // setup timers
    config.options.timers?.forEach((timer) => {
        if (!enabled || !timer.do || !timer.every) return;
        
        let timerSet = setInterval(() => {
            if (player.InGame) {
                log.write('/timers/execute', `running timer *${JSON.stringify(timer.do)}*`);
                processEvent(timer.do);
            }
        }, timer.every * 1000);
        
        log.write('/timers', `created timer every *${timer.every}* seconds. *${JSON.stringify(timer.do)}*`);
        timers.push(timerSet);
    });
}


//
// config change functions
//
config.init((options) => {
    //
    // handle every YAML load
    //
    if (options.log) log.setLog(options.log);
    if (options.disk) log.setDisk(options.disk);
    
    log.write('/config', 'reloaded file');
    proxy?.writeMessage("Config file reloaded.");
    
    player.Config = config;
    
    // match the bot specified in the config file
    botResponse = new RegExp(`^/${options.botname}`);
    setTimers();
    if (proxy) enqueueCommand('st');
}, (error) => {
    //
    // error loading YAML
    //
    log.write('/config/errors', `!${error}!`);
    proxy?.writeMessage("Error loading config file: " + error);
}).then((options) => {
    //
    // this code only happens on the first init called
    //
    proxy = new TelnetProxy(options.server.listen, options.bbs.host, options.bbs.port);
    
    proxy.onClientsDisconnected = () => {
        log.write('/telnet/disconnects', 'player disconnected');
        player.InGame = false;
    }

    //
    // INCOMING FROM MMUD/GMUD/PMUD
    //
    proxy.onIncoming = function* (data) {
        clearInterval(deadInterval);

        if (!enabled) {
            yield data;
            return;
        }
        const dataStr = data.toString();

        log.write('/messaging/incoming/data/noAnsi', dataStr.replaceAll(/\u001B/g, '').replaceAll(/\r/g, '\\r').replaceAll(/\n/g, '\\n').replaceAll(/\\b/g, '\\b'));
        log.write('/messaging/incoming/data/ansi', dataStr);

        // reset in game when we see a status line
        if (!player.InGame && statusLine.test(dataStr.replaceAll(ansiCodes, ''))) {
            enqueueCommand('st');
            player.InGame = true;
        }

        if (!player.InGame) {
            log.write('/messaging/incoming', 'player not in game');
            return yield data;
        }
        
        const noAnsiDataStr = dataStr.replaceAll(ansiCodes, '');

        clearTimeout(bannerTimer);
        
        for (let line of dataStr.split(/(?<=\r\n|\r|\n)/)) {
            let handled = false;
            log.write('/messaging/incoming/data/line', line.replaceAll(/\u001B/g, ''));

            let noAnsiLine = line.replaceAll(ansiCodes, ''); // without ansi for testing against config
            let lastNoAnsi = lastLine?.replaceAll(ansiCodes, ''); // last line from before with no ansi codes
            
            // if it has a \r or \n clear it. weve got a new line. if the last one was a status line and this one
            // is a status line update to the latest. otherwise append (something being typed in)
            if (/(\r|\n)/.test(line)) {
                lastLine = "";
            } else if (statusLine.test(noAnsiLine) && statusLine.test(lastNoAnsi)) {
                lastLine = line;
            } else {
                lastLine += line;
            }

            // save the last StatusLine for Fake Bot
            if (statusLine.test(noAnsiLine)) lastStatusLine = line;

            handled = handled || handleMessages(noAnsiLine);
            handled = handled || handleRemotes(noAnsiLine);
            
            player.processMessage(noAnsiLine);

            if (!handled) yield line;
        }
        
        if ((mc = mobCount(noAnsiDataStr)) !== undefined) {
            // if the mobCount changes
            if (mobs !== mc) {
                raiseEvent(`mobCount <= ${mc}`);
                raiseEvent(`mobCount ${mc}`);
                if (mobs == 0 && mc > 0) {
                    raiseEvent(`mobCount > 0`);
                }
                mobs = mc;
            }

            config.set('mobs', mc);
        }
        
        player.processBlock(noAnsiDataStr);

        //
        // process outgoing command queue after each block of text
        // is received
        //
        if (!userIsTyping) {
            let dequeued = queue.shift();
            if (dequeued) processCommand(dequeued);
            
            if (config.options.banner) {
                writeBanner();
            }
        }
    }

    //
    // OUTGOING
    //
    //
    // we either get letter by letter and then a \n such as d a n c e \n
    // or we get something from megamud or convo box such as spit\n
    // so we need to process the output handlers and then take the command and send it if needed
    // but we need to backspace either way if something has been typed in
    //
    proxy.onOutgoing = function* (buffer) {
        for (let data of buffer.toString().split(/(?<=\r)/)) {
            if (!enabled || !player.InGame) {
                yield data;
                continue;
            }

            let handled = false;
            
            log.write('/messaging/outgoing/command/data', `*${data}*`);
            // sets the command if user is typing or directly sent
            command = (data === '\b' && command.length > 0) ? command.slice(0, -1) : command + data;

            // if there is no \r\n then we haven't finished receiving the full command
            if (!/(\n|\r)/.test(data)) {
                userIsTyping = command.length > 0;
                yield data;
                continue;
            }
            
            userIsTyping = false; // must be set before event processing below

            // get just the text portion of the command for matching
            let commandText = command.replaceAll(/\n/g, '\\n').replaceAll(/\r/g, '\\r');
            command = command.replaceAll(/\n/g, '').replaceAll(/\r/g, '');

            log.write('/messaging/outgoing/command', `*${commandText}*`);
            
            handled = handleProxyCommands(command) || botResponse.test(data);

            if (handled) {
                let clear;

                // if the only key pressed was \r then it was typed in so clear it
                if (/^\r/.test(data)) {
                    log.write('/messaging/outgoing/command', `clearing *${command}*`);
                    clear = "\b".repeat(command.length);
                }

                command = "";
                yield clear;
                continue;
            }
            
            player.processOutgoing(command);

            let cmd = command;
            let out = handleOutput(command);
            
            // it was handled and no continuation (suppressed)
            if (out && !out.continue) {
                log.write('/messaging/outgoing/output', `*${command}* handled, no continue.`);
                command = "";
                continue;
            }
            
            // it was handled and we need to still send it
            // and an event cleared it out
            if (out && command == "") {
                data = cmd + "\r\n"; 
                log.write('/messaging/outgoing/output', `handled, continue: *${data}*`);
            }
            
            command = "";
            
            yield data;
        }
    }
    
    proxy.onServerWrite = (data) => {
        return substituteVariables(data).join('\r');
    }

    proxy.onClientWrite = (data) => {
        if (!player.InGame) return data;
        return substituteVariables(data).join('\r');
    }
    
    if (config.options.discord && !config.options.discord.disabled) {
        discord.login(config.options.discord.bot);

        discord.on('ready', () => {
            log.write('/discord', `Logged in as ${discord.user.tag}!`);
        });

        discord.on('messageCreate', async message => {
            console.log(message);
            if (config.options.discord?.channel !== message.channelId) {
                log.write('/discord', `channelId *${message.channelId}* does not match expected *${config.options.discord.channel}*`);
                return;
            }

            if (!config.options.discord.users?.hasOwnProperty(message.author.username)) {
                log.write('/discord', `user *${message.author.username}* not found.`);
                return;
            }

            log.write('/discord', `Received message ${message.content}`);

            let response;

            if (match = message.content.match(/^!seen (\w+)/)) {
                let args = match[1];
                response = `I last saw ${args}:` + seen[args] ? seen[args] : 'never';
            }

            if (match = message.content.match(/^!test (.+)/)) {
                let args = match[1];
                response = substituteVariables(args);
            }
            log.write('/discord', `response *${response}*`);

            if (response) {
                const channel = await discord.channels.fetch(config.options.discord.channel);
                channel.send(`${config.options.discord.users[message.author.username]}: ${response}`);
            }
        });
    }
});

function handleProxyCommands(command) {
    //
    // set variables
    //
    if (match = command.match(/^set (?!pal|palette|gos|gossip|auc|auction|recoverpw|suicide|receive|follow|warn|entrance|entrances|logoff|logoffs|talk|statline|mineps)(\w+) (.*)/)) {
        let name = match[1];
        let value = match[2];
        log.write('/messaging/outgoing/command/proxy', `set *${name}*=*${value}*`);

        // TODO: clear the line? i seem to see the remaining value sometimes
        proxy.writeMessage(`Setting ${name} to ${value}`);
        config.set(name, value);
        return true;
    }
    
    //
    // clear variables
    //
    if (match = command.match(/^(?:del|delete|clear|unset) (\w+)/)) {
        if (match[1] in config.state) {
            log.write('/messaging/outgoing/command/proxy', `clearing *${match[1]}*`);
            proxy.writeMessage(`Clearing ${match[1]}`);
            delete config.state[match[1]];
            config.persist();
            return true;
        // arrays
        } else if (Object.keys(config.state).some(key => key.startsWith(match[1] + '['))) {
            log.write('/messaging/outgoing/command/proxy', `clearing *${match[1]}*`);
            proxy.writeMessage(`Clearing ${match[1]}`);
            for (let key of Object.keys(config.state).filter(key => key.startsWith(match[1] + '['))) {
                delete config.state[key];
            }
            config.persist();
            return true;
        }
    }
    
    //
    // print out current variables
    //
    if (command.match(/^state$/)) {
        log.write('/messaging/outgoing/command/proxy', `state`);
        const values = Object.entries(config.state).map(([key, value]) => `${key} = ${value}`);
        proxy.writeMessage(values);
        return true;
    }
    
    if (command == "enable") {
        log.write('/messaging/outgoing/command/proxy', `enable`);
        player.InGame = true;
        enabled = true;
        proxy.writeMessage("Proxy Enabled");
        return true;
    }
    
    if (command == "disable") {
        log.write('/messaging/outgoing/command/proxy', `disable`);
        proxy.writeMessage("Proxy Disabled");
        enabled = false;
        player.InGame = false;
        return true;
    }
    
    //
    // debug
    //
    if (match = command.match(/^value (\w+)/)) {
        try {
            proxy.writeMessage(`Value: ${JSON.stringify(eval(match[1]))}`);
        } catch (e) 
        {
        }
    }
    
    //
    // user request status to set off spells
    //
    if (command.match(/^(st|sta|stat|status)$/)) {
        log.write('/messaging/outgoing/command/proxy', `status`);
        firstStatus = true;
    }
    
    if (command.match(/^train stats$/)) {
        log.write('/messaging/outgoing/command/proxy', `train stats`);
        player.InGame = false;
        firstStatus = false;
    }
    
    if (match = command.match(/^top (?!level|\d+|pvp|gang)(\w+)/)) {
        response = player.listPlayerEntries(match[1]);
        proxy.writeMessage(response);
        return true;
    }
    
    return false;
}

function mobCount(data) {
    // parse Also here count
    if (match = /^Also here: (.*)\./ms.exec(data)) {
        let seenTime = new Date();
        let list = match[1];
        let mobs = list.split(',');

        mobs.forEach((mob) => {
            mob = mob.trim().replaceAll(/\*/g, '');
            log.write('/parsing/mobs', `seen *${mob}* @ ${seenTime}`);
            seen[mob] = seenTime;
        });
        return mobs.filter(mob => /^[^A-Z]*$/.test(mob.trim())).length;
    }
    
    // got Obvious exits, but no Also here
    if (/^(?!.*^Also here:).*^Obvious exits:.*/ms.test(data)) {
        return 0;
    }
    
    return;
}

function formatDate(date) {
    return date.toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}


function processCommand(command) {
    handled = handleProxyCommands(command);
    log.write('/messaging/outgoing/command/proxy', `handled: *${handled}*`);

    if (!handled) {
        // TODO: am i referencing global command here for length?
        log.write('/messaging/outgoing/command/proxy', `not handled command *${command}*`);
        proxy.writeServerLine("\b".repeat(command.length) + command);
        command = "";
    }
}

//
// sends a command if the user is not typing otherwise queues it up for completion
// when the user is done typing
//
function enqueueCommand(line) {
    log.write('/messaging/outgoing/command/enqueue', `*${line}*`);

    if (!userIsTyping) {
        log.write('/messaging/outgoing/command/enqueue', 'processing now');
        processCommand(line);
    } else if (!queue.includes(line)) {
        log.write('/messaging/outgoing/command/enqueue', 'processing later');
        queue.push(line);
    }
}

function setMidRoundTimer() {
    clearTimeout(midRoundTimer);
    midRoundTimer = setTimeout(() => {
        raiseEvent('midRound');
    }, 100);
}

function handleMessages(line) {
    var hide = false;
    
    config.options.messages?.forEach((message) => {
        let result = matchAndExtract(line, message.find, message.anywhere ?? false, message.array);
        
        if (!result.matched) return false;
        
        log.write('/config/messages', `matched message to *${message.find}*`);
        
        for (let key in result.variables) {
            config.set(key, result.variables[key]);
        }
        
        if (message.raise) raiseEvent(message.raise);
        if (message.do) processEvent(message.do);
        hide = hide || message.hide;
    });
    
    if (hide) log.write('/config/messages', `attempting to hide line *${line}*`);
    return hide;
}

function handleOutput(line) {
    if (!config.options.output) return;
    log.write('/messaging/output/config/output', `checking line *${line}*`);

    for (let output of config.options.output) {
        let result = matchAndExtract(line, output.message, output.anywhere ?? false);
        
        if (result.matched) {
            log.write('/messaging/output/config/output', `matched`);
            for (let key in result.variables) {
                config.set(key, result.variables[key]);
            }
            
            if (output.raise) raiseEvent(output.raise);
            if (output.do) processEvent(output.do);
            
            return output;
        }
    }
}

function handleRemotes(data) {
    var target;
    var response;
    var pre;
    var raise;
    var allowed;

    if (match = /^(\w+) telepaths: (@[a-zA-Z]+)\s*(.*)/.exec(data)) {
        var who = match[1];
        var msg = match[2];
        var args = match[3];
        log.write('/messaging/remotes', `WHO *${who}* MSG *${msg}* ARGS *${args}*`);
        target = `/${who} `;
        
        if (msg === '@when') {
            if (args) {
                response = seen[args] ? seen[args] : 'never';
                log.write('/messaging/remotes', `RESPONSE *${response}*`);
            }
        }

        if (msg === '@top') {
            if (args) {
                response = player.listPlayerEntries(args);
            }
        }
        
        config.options.responses.forEach((item) => {
            if (item.command === msg) {
                response = `${item.response}`;
                pre = item.pre;
                raise = item.raise;
                allowed = flattenArray(item.allowed);
            }
        });
    }
    
    if (match = /^(\w+) says "(@.*)"/.exec(data)){
        var who = match[1];
        var msg = match[2];
        
        config.options.responses.forEach((item) => {
            if (item.command === msg) {
                target = `>${who} `;
                response = `${item.response}`;
                pre = item.pre;
                raise = item.raise;
                allowed = flattenArray(item.allowed);
            }
        });
    }
    
    if (target && response) {
        if (allowed && !allowed.includes(who)) {
            proxy.writeServerLine(`${target}[Not Allowed]`);
            return true;
        }

        if (pre) processCommand(pre);
        if (raise) raiseEvent(raise);

        setTimeout(() => {
            log.write('/messaging/incoming/remotes', `*${target}* *${response}*`);
            if (response instanceof Array) {
                response.forEach(msg => enqueueCommand(`${target}${msg}`));
            } else {
                enqueueCommand(`${target}${response}`);
            }
        }, 300);

        return true;
    }
    
    return false;
}

function escapeRegExp(string) {
    // Escape characters with special meaning in regex
    return string.replace(/[|.+?^$()[\]\\]/g, '\\$&');
}

function matchAndExtract(input, template, anywhere, arrayName) {
    // Replace * with \s* to match any whitespace
    let escaped = escapeRegExp(template);
    let regexPattern = escaped.replace('*', '\\s*');

    // Find all {variable} patterns and replace them with regex groups
    const variableNames = [];
    regexPattern = regexPattern.replace(/\{(\w+)\}/g, (match, variableName) => {
        variableNames.push(variableName);
        return '(.+)';
    });
    
    if (!anywhere) {
        regexPattern = "^" + regexPattern;
    }

    // Create a RegExp object
    const regex = new RegExp(regexPattern);
    
    // Match the input with the regex
    const matches = input.match(regex);

    // If there is no match, return a status indicating no match
    if (!matches) {
        return { matched: false, variables: {} };
    }
    log.write('/messaging/match', `matched *${input}* with *${regexPattern}*`);

    clearInterval(arrayInterval);

    // Extract variables
    const variables = {};
    variableNames.forEach((name, index) => {
        name = arrayName ? arrayName + `[${arrayNum}] > ` + name : name;
        variables[name] = matches[index + 1];
    });
    
    if (arrayName) {
        arrayNum++;
        setInterval(() => { arrayNum = 0; }, 500);
    }

    return { matched: true, variables: variables };
}

function raiseEvent(name) {
    log.write('/config/events', `raising event *${name}*`);
    Object.entries(config.options.events).forEach((entry) => {
        const [key, value] = entry;

        if (key == name && value) {
            processEvent(value);
        }
    });
}

function sleep(delay) {
    const start = new Date().getTime();
    while (new Date().getTime() < start + delay);
}

function processEvent(event) {
    const comparisonFunctions = {
        '=': (a, b) => a == b,
        '<': (a, b) => a < b,
        '>': (a, b) => a > b,
        '<=': (a, b) => a <= b,
        '>=': (a, b) => a >= b,
        '!=': (a, b) => a != b
    };
    
    let steps = flattenArray(event);
    
    for (let step of steps) {
        log.write('/config/events/step', `*${step}*`);

        if (step.startsWith("bot:")) {
            let command = step.split(":")[1];
            log.write('/config/events/step/bot', `*${command}*`);
            sendBotCommand(command);
        } else if (step.startsWith("delay:")) {
            let delay = parseInt(step.split(":")[1], 10);
            log.write('/config/events/step/delay', `*${delay}*`);
            sleep(delay);
        } else if (step.startsWith("mob:")) {
            let mob = step.split(":")[1];
            
            if (!player.mobInRoom(mob)) {
                log.write('/config/events/step/mob', `mob *${mob}* not found in room.`);
                return;
            }
        } else if (step.startsWith("hasItem:")) {
            let item = step.split(":")[1];
            
            if (!player.hasItem(item)) {
                log.write('/config/events/step/hasItem', `you do not have item *${item}*`);
                return;
            }
        } else if (step.startsWith("test:")) {
            let test = step.split(":")[1];
            let failEvent = step.split(":")[2];

            if (matches = test.match(/([^\s]+)\s*(<=|>=|=|<|>|!=|defined)\s*([^\s]+)/)) {
                let left = matches[1];
                const condition = matches[2].trim();
                let right = matches[3];

                left = substituteVariables(left.trim()).toString();
                right = substituteVariables(right.trim()).toString();
                
                log.write('/config/events/step/test', `[*${left}*] [!${condition}!] [*${right}*]`);
                evaluate = comparisonFunctions[condition](left, right);
                
                if (!evaluate) {
                    if (failEvent) {
                        log.write('/config/events/step', `raising failEvent ${failEvent}`);
                        raiseEvent(failEvent);
                    } else {
                        log.write('/config/events/step', 'stopping execution');
                    }
                    return;
                }
            }
        } else {
            log.write('/config/events/step/step', `*${step}*`);
            enqueueCommand(step);
        }
    }
}

// can be a comma delimited string or an array
function flattenArray(arr) {
    if (!Array.isArray(arr)) {
        return [arr];
    }

    return arr.reduce((acc, val) => 
        Array.isArray(val) ? acc.concat(flattenArray(val)) : acc.concat(val), []);
}

function substituteVariables(template) {
    let rawMatches = template.match(/{!?(.*?)}/g);

    if (!rawMatches) {
        return [template];
    }

    let matches = [...new Set(rawMatches.map(match => match.slice(1, -1)))];

    // Check if any variable with '!' prefix does not exist and return empty string
    for (let match of matches) {
        if (match.startsWith('!') && (config.state[match.slice(1)] === undefined || config.state[match.slice(1)] === null)) {
            return [''];
        }
    }

    let hasArray = matches.some(key => Array.isArray(config.state[key.replace(/^!/, '')]));
    if (hasArray) {
        let results = [];
        for (let key of matches) {
            key = key.replace(/^!/, ''); // Remove '!' prefix for array keys
            if (Array.isArray(config.state[key])) {
                for (let item of config.state[key]) {
                    let newData = template.replace(new RegExp(`{!?${key}}`, 'g'), item);
                    results.push(...substituteVariables(newData));
                }
                return results;
            }
        }
    } else {
        return [matches.reduce((acc, key) => {
            if (key.startsWith('!')) {
                key = key.slice(1);
                return acc.replace(new RegExp(`{!?${key}}`, 'g'), config.state[key] ?? '');
            } else {
                return config.state[key] !== undefined ? acc.replace(`{${key}}`, config.state[key]) : acc;
            }
        }, template)];
    }
}

function sendBotCommand(command) {
    var bot = config.options.botname;
    
    //proxy.writeClients(`\r\n\u001B[0m\u001B[79D\u001B[K\u001B[0;32m${bot} telepaths: \u001B[0;37m${command}`);
    proxy.writeClients(`\r\n\u001B[0m\u001B[79D\u001B[K\u001B[0;32m${bot} telepaths: \u001B[0;37m${command}\r\n`);
    //proxy.writeClients(bol + clearLine + "\r\n");
    proxy.writeClients(lastStatusLine);
}

const fgWhite = '\u001B[1;37;44m';
const reset = '\u001B[0m';
const saveCursor = '\u001B[s';
const moveHome = '\u001B[H';
const restoreCursor = '\u001B[u';
const clearLine = '\u001B[79K';
const bol = '\u001B[79D';
const lineUp = '\u001B[A';
const lineEnd = '\u001B[999C';

function writeBanner() {
    proxy.writeClients(saveCursor + moveHome + clearLine);
    proxy.writeClients(fgWhite);
    proxy.writeClients(`[${config.options.banner}]`);
    proxy.writeClients(reset);
    proxy.writeClients(restoreCursor + lineUp + lineEnd + '\n');
    proxy.writeClients(lastLine);
}