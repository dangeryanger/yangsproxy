const EventEmitter = require('events');
const log = require('./log.js');

class Player extends EventEmitter {
    #hp;
    #maxhp;
    #mana;
    #maxmana;
    #kai = false;
    #affectedSpells = [];
    #queuedSpells = [];
    #spellDurations = {};
    #inGame = false;
    #combatEngaged = false;
    #attackCommands = ['aa', 'all', 'allo', 'allou', 'allout', 'bas', 'bash', 'a', 'at', 'att', 'atta', 'attac', 'attack', 'bs', 'sm', 'sma', 'smas', 'smash'];
    #backstabCommands = ['bs'];
    #config;
    #topList = [];
    #inventory;
    #mobsInRoom;
    #seen = {};
    
    set Config(config) { this.#config = config; }

    get HP() { return this.#hp; }
    set HP(value) { this.#hp = value; }

    get HPPercent() {
        if (this.#maxhp > 0) {
            return this.#hp / this.#maxhp;
        }

        return 0;
    }

    get KAI() { return this.MA };
    set KAI(value) { this.MA(value); }
    get MA() { return this.#maxhp; }
    set MA(value) { this.#mana = value; }

    get MAPercent() {
        if (this.#maxmana > 0) {
            return this.#mana / this.#maxmana;
        }

        return 0;
    }

    get InGame() { return this.#inGame; }
    set InGame(value) { this.#inGame = value; }
    
    get SpellDurations() { return this.#spellDurations; }

    nextQueuedSpell() {
        return this.#queuedSpells[0];
    }

    // queues a spell if not already in use
    queueSpellNotInUse(spell) {
        // player is not affected by this spell currently
        if (!this.#affectedSpells.some(inuse => inuse.start === spell.start)) {
            if (!this.#queuedSpells.some(queue => queue.start === spell.start)) {
                log.write('/spells', `queueing spell not in use *${spell.name ? spell.name : spell.start}*`);
                this.#queuedSpells.push(spell);
            }
        } else if (spell.early) {
            let name = spell.name ? spell.name : spell.start;
            // they are affected but we want early regen
            if (this.#spellDurations.hasOwnProperty(name) && this.#spellDurations[name] > 0) {
                let delta = new Date() - this.#spellDurations[name].duration;

                if (delta * 1000 >= spell.duration) {
                    log.write('/spells', `queueing spell early *${name}*`);
                    this.#queuedSpells.push(spell);
                }
            }
        }
    }

    removeQueuedSpell(spell) {
        log.write('/spells', `removing queued spell *${spell.name ? spell.name : spell.start}*`);
        this.#queuedSpells = this.#queuedSpells.filter(queue => queue.start !== spell.start);
    }

    addAffectedSpell(spell) {
        if (!this.#affectedSpells.some(affected => affected.start === spell.start)) {
            log.write('/spells', `affected by spell *${spell.name ? spell.name : spell.start}*`);
            this.#affectedSpells.push(spell);
        }
    }

    removeAffectedSpell(spell) {
        log.write('/spells', `removing affected spell *${spell.name ? spell.name : spell.start}*`);
        this.#affectedSpells = this.#affectedSpells.filter(affected => affected.stop !== spell.stop);
    }

    clearAffectedSpells() {
        log.write('/spells', `clearing all affected spells`);
        this.#affectedSpells = [];
    }

    shouldCastSpell(spell) {
        if (!spell) return false;

        if (spell.above && this.MAPercent >= spell.above) {
            log.write('/spells', `not casting spell above *${spell.above}*, *${spell.name ? spell.name : spell.start}* current Mana% *${this.MAPercent}`);
            return false;
        }
        return true;
    }

    processMessage(line) {
        this.#checkSpells(line);
        if (/^Race: (\w+)/.test(line)) this.clearAffectedSpells(); // should repopulate from status

        // TODO: how to handle this unless player raises events???
        if (/\*Combat Off\*/.test(line)) {
            this.#config.set('mob', '');
            this.#combatEngaged = false;
            this.emit('combatOff');
        }

        if (/\*Combat Engaged\*/.test(line)) {
            this.#combatEngaged = true;
            this.emit('combatEngaged');
        }

        if (/You(?! use).* for \d+ damage!/.test(line)) this.emit('playerSwing');
        if (/You (swing|lunge) at (.*)!/.test(line)) this.emit('playerSwing');
        if (/You gain (\d+) experience\./.test(line)) {
            this.#config.set('mob', '');
            this.emit('mobDied');
        }

        if (match = line.match(/^Hits:\s+(\d+)\/(\d+)\s/)) {
            this.#hp = match[1];
            this.#maxhp = match[2];
        }

        if (match = line.match(/^(Mana|Kai):[\s*]+(\d+)\/(\d+)/)) {
            this.#mana = match[2];
            this.#maxmana = match[3];
        }

        if (match = line.match(/\[HP=(\d+)\/(KAI|MA)=(\d+)/)) {
            this.#hp = match[1];
            this.#kai = match[2] === "KAI";
            this.#mana = match[3];
            this.emit('statusLine');
        }
        
        if (match = line.match(/^\s*\d+\.\s*(\w+)/)) {
            const name = line.substring(5, 25).trim().split(' ')[0]; // Extract the first word of the name from characters 5 to 25
            const experienceStr = line.substring(58).trim(); // Experience starts at character 58
            const experience = parseInt(experienceStr.replace(/\D/g, ''), 10); // Clean non-digit characters and convert to integer
            
            this.#topList.push({
                name: name,
                experience: experience,
                date: new Date()
            });
            this.#topList = this.#topList.filter(top => (new Date() - top.date) <= 72*60*60*1000); // older than 48 hours
        }
    }

    // Function to list all entries for a specific player and summarize the total and average experience
    listPlayerEntries(playerName) {
        const filteredEntries = this.#topList.filter(entry => entry.name === playerName);
        let response = [];

        // Ensure the entries are sorted by date
        filteredEntries.sort((a, b) => a.date - b.date);

        if (filteredEntries.length > 1) {
            const oldestExp = filteredEntries[0].experience;
            const newestExp = filteredEntries[filteredEntries.length - 1].experience;
            const totalExpDelta = newestExp - oldestExp;

            filteredEntries.forEach(entry => {
                response.push(`${entry.name}: Date: ${entry.date.toISOString()}, Exp: ${entry.experience}`);
            });

            // Calculate average experience per hour
            const totalTimeHours = (filteredEntries[filteredEntries.length - 1].date - filteredEntries[0].date) / 3600000;
            const averageExpPerHour = totalTimeHours ? totalExpDelta / totalTimeHours : 0;

            response.push(`Delta Exp: ${totalExpDelta}, Average Exp per Hour: ${averageExpPerHour.toFixed(2)}`);
        } else if (filteredEntries.length === 1) {
            response.push(`${filteredEntries[0].name}: Date: ${filteredEntries[0].date.toISOString()}, Exp: ${filteredEntries[0].experience}`);
            response.push(`Only one entry exists. No delta to calculate.`);
        } else {
            response.push(`No entries found for player: ${playerName}`);
        }
        
        return response;
    }

    processOutgoing(command) {
        let first = command.split(" ")[0];
        let args = command.split(" ").slice(1).join(" ");
        
        if (['st', 'sta', 'stat', 'status'].includes(command)) {
            log.write('/spells', `clearing all affected spells`);
            this.clearAffectedSpells();
        }
        
        // command is an attacking command
        if (this.#attackCommands.includes(first) && args) {
            log.write('/messaging/outgoing/parsing', `attack command mob *${args}*`);
            this.#config.set('mob', args);
        }
    }
    
    mobInRoom(mob) {
        return this.#mobsInRoom.some(name => name.includes(mob));
    }
    
    processBlock(data) {
        if (/You are carrying/g.test(data)) {
            this.parseInventory(data);
        }

        if (match = /^Also here: (.*)\./ms.exec(data)) {
            this.#mobsInRoom = [];
            let seenTime = new Date();
            let list = match[1];
            let mobs = list.split(',');

            mobs.forEach((mob) => {
                this.#mobsInRoom.push(mob);
                mob = mob.trim().replaceAll(/\*/g, '');
                log.write('/parsing/mobs', `seen *${mob}* @ ${seenTime}`);
                this.#seen[mob] = seenTime;
            });
            return mobs.filter(mob => /^[^A-Z]*$/.test(mob.trim())).length;
        }

        // got Obvious exits, but no Also here
        if (/^(?!.*^Also here:).*^Obvious exits:.*/ms.test(data)) {
            this.#mobsInRoom = [];
            return 0;
        }
    }
    
    parseInventory(data) {
        let invre = /You are carrying (?:Nothing!|(?<items>.+)).+(?:You have the following keys: (?<keys>.+)\.|You have no keys\.).+Wealth: (?<wealth>\d+) copper farthings.+Encumbrance: (?<encum>\d+)\/(?<maxenc>\d+) - (?<weight>\w+) \[\d+%\].*$/s;
        let inv = invre.exec(data);
        
        if (inv.groups.items) {
            let items = this.processItems(inv.groups.items);
            this.#inventory = items;
        }
        
        if (inv.groups.keys) {
            let keys = this.processItems(inv.groups.keys);
            this.#inventory = [...this.#inventory, ...keys];
        }
    }
    
    processItems(items) {
        items = items.replaceAll(/\r\n/g, ' ')
        items = items.replaceAll(/\r/g, ' ').replaceAll(/\n/g, ' ')
        
        let result = [];
        
        items.split(/,/).forEach((item) => {
            item = / *(?:(?<qty>\d+) )*(?<name>[-'\w ]+)\s?(?:\((?<equipped>[A-Za-z ]+)(?:\/\d+)?\))?/.exec(item);
            result.push({
                name: item.groups.name.trim(),
                qty: item.groups.qty ? item.groups.qty : 1,
                equipped: item.groups.equipped
            });
        });
        
        return result;
    }
    
    hasItem(item) {
        return this.#inventory?.some(it => it.name == item);
    }

    #checkSpells(line) {
        // for all configured spells
        this.#config.options.spells?.filter(spell => !spell.disabled).forEach((spell) => {
            // it can be statline + message or just message
            let spellmatch = new RegExp(`^(\\[.*\\]:)?${spell.start}(\\r|\\n)?`);

            // this is a start message, so add it to inUse and remove it from spells to cast
            if (spellmatch.test(line)) {
                this.removeQueuedSpell(spell);
                this.addAffectedSpell(spell);
                
                let name = spell.name ? spell.name : spell.start;
                if (!this.#spellDurations.hasOwnProperty(name)) {
                    this.#spellDurations[name] = {};
                    this.#spellDurations[name].duration = 0;
                }
                this.#spellDurations[name].start = new Date();
            }

            spellmatch = new RegExp(`^(\\[.*\\]:)?${spell.stop}(\\r|\\n)?`);

            // this is a stop message, so add it to spells to cast and remove it from inUse
            if (spellmatch.test(line)) {
                this.removeAffectedSpell(spell);
                this.queueSpellNotInUse(spell);

                let name = spell.name ? spell.name : spell.start;

                if (this.#spellDurations.hasOwnProperty(name)) {
                    this.#spellDurations[name].stop = new Date();
                    
                    let delta = this.#spellDurations[name].stop - this.#spellDurations[name].start;
                    if (delta > this.#spellDurations[name].duration) {
                        this.#spellDurations[name].duration = delta;
                    }
                }
            }
        });
    }
}

module.exports = Player;