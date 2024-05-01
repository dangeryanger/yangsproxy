// config.js
const nedb = require('@seald-io/nedb');
const { error } = require('console');
const fs = require('fs');
const YAML = require('yaml');
var log = require('./log.js');

class Configuration {
    #filename;
    #data;
    #db;
    #loadCallback;
    #errorCallback;
    #fsTimeout;
    
    get state() { return this.#data.state }
    get options() { return this.#data }
    get id() { return { program: 'tp' } }
    
    constructor(filename) {
        this.#filename = filename;
        this.stateFile = process.cwd() + "/tp.db";
        this.#db = new nedb({ filename: this.stateFile, autoload: true });

        fs.watchFile(this.#filename, (curr, prev) => {
            if (curr.mtime !== prev.mtime) {
                console.log(`File ${this.#filename} has been modified`);
                this.#loadYamlFile(this.#filename);
            }
        });
    }
    
    async init(loadCallback = null, errorCallback = null) {
        this.#loadCallback = loadCallback;
        this.#errorCallback = errorCallback;
        await this.#loadYamlFile(this.#filename);
        return this.#data;
    }
    
    async #loadYamlFile(filePath) {
        console.log("Loading config file: " + filePath);
        try {
            const fileContents = fs.readFileSync(filePath, 'utf8');

            this.#data = YAML.parse(fileContents);
            if (!this.#data) {
                log.write('/config/yaml/load/errors', '!#data is null!')
            }
            this.#data.state = await this.#loadPersisted() ?? {};
            
            // variables in the YAML are not saved as state and are dynamically loaded every time
            for (let key in this.#data.variables) {
                this.#data.state[key] = this.#data.variables[key];
            }
            
            if (this.#loadCallback && !this.#fsTimeout) {
                this.#loadCallback(this.#data);
                this.#fsTimeout = setTimeout(() => { this.#fsTimeout = null }, 500);
            }
        } catch (e) {
            if (this.#errorCallback && !this.#fsTimeout) {
                this.#errorCallback(e);
                this.#fsTimeout = setTimeout(() => { this.#fsTimeout = null }, 500);
            }

            console.log("Invalid config file. Not loading changes: " + e);
        }
    }
    
    persist() {
        return this.#db.update(this.id, this.#data.state );
    }
    
    async #loadPersisted() {
        return await this.#db.findOneAsync(this.id);
    }
    
    set(name, value) {
        this.#data.state[name] = value;
        this.persist();
    }
}


if (require.main === module) {
    var config = new Configuration(__dirname + "/tp.yaml");
    config.init();
    console.log(`Listen ${config.data.server.listen} BBS ${config.data.bbs.host} Port ${config.data.bbs.port}`);
}

module.exports = Configuration;