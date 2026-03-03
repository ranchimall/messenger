(function (EXPORTS) { //floDapps v2.4.1
    /* General functions for FLO Dapps*/
    'use strict';
    const floDapps = EXPORTS;

    const DEFAULT = {
        root: "floDapps",
        application: floGlobals.application,
        adminID: floGlobals.adminID
    };

    Object.defineProperties(floDapps, {
        application: {
            get: () => DEFAULT.application
        },
        adminID: {
            get: () => DEFAULT.adminID
        },
        root: {
            get: () => DEFAULT.root
        }
    });

    var user_priv_raw, aes_key, user_priv_wrap; //private variable inside capsule
    const raw_user = {
        get private() {
            if (!user_priv_raw)
                throw "User not logged in";
            return Crypto.AES.decrypt(user_priv_raw, aes_key);
        }
    }

    var user_id, user_public, user_private, user_loginID;
    const user = floDapps.user = {
        get id() {
            if (!user_id)
                throw "User not logged in";
            return user_id;
        },
        get loginID() {
            if (!user_loginID)
                return user_id; // Default to FLO ID if not set
            return user_loginID;
        },
        get public() {
            if (!user_public)
                throw "User not logged in";
            return user_public;
        },
        get private() {
            if (!user_private)
                throw "User not logged in";
            else if (user_private instanceof Function)
                return user_private();
            else
                return Crypto.AES.decrypt(user_private, aes_key);
        },
        sign(message) {
            return floCrypto.signData(message, raw_user.private);
        },
        decrypt(data) {
            return floCrypto.decryptData(data, raw_user.private);
        },
        encipher(message) {
            return Crypto.AES.encrypt(message, raw_user.private);
        },
        decipher(data) {
            return Crypto.AES.decrypt(data, raw_user.private);
        },
        get db_name() {
            return "floDapps#" + floCrypto.toFloID(user.id);
        },
        lock() {
            user_private = user_priv_wrap;
        },
        async unlock() {
            if (await user.private === raw_user.private)
                user_private = user_priv_raw;
        },
        get_contact(id) {
            if (!user.contacts)
                throw "Contacts not available";
            else if (user.contacts[id])
                return user.contacts[id];
            else {
                let id_raw = floCrypto.decodeAddr(id).hex;
                for (let i in user.contacts)
                    if (floCrypto.decodeAddr(i).hex == id_raw)
                        return user.contacts[i];
            }
        },
        get_pubKey(id) {
            if (!user.pubKeys)
                throw "Contacts not available";
            else if (user.pubKeys[id])
                return user.pubKeys[id];
            else {
                let id_raw = floCrypto.decodeAddr(id).hex;
                for (let i in user.pubKeys)
                    if (floCrypto.decodeAddr(i).hex == id_raw)
                        return user.pubKeys[i];
            }
        },
        clear() {
            user_id = user_public = user_private = user_loginID = undefined;
            user_priv_raw = aes_key = undefined;
            delete user.contacts;
            delete user.pubKeys;
            delete user.messages;
        }
    };

    Object.defineProperties(window, {
        myFloID: {
            get: () => {
                try {
                    return user.id;
                } catch {
                    return;
                }
            }
        },
        myUserID: {
            get: () => {
                try {
                    return user.id;
                } catch {
                    return;
                }
            }
        },
        myPubKey: {
            get: () => {
                try {
                    return user.public;
                } catch {
                    return;
                }
            }
        },
        myPrivKey: {
            get: () => {
                try {
                    return user.private;
                } catch {
                    return;
                }
            }
        }
    });

    var subAdmins, trustedIDs, settings;
    Object.defineProperties(floGlobals, {
        subAdmins: {
            get: () => subAdmins
        },
        trustedIDs: {
            get: () => trustedIDs
        },
        settings: {
            get: () => settings
        },
        contacts: {
            get: () => user.contacts
        },
        pubKeys: {
            get: () => user.pubKeys
        },
        messages: {
            get: () => user.messages
        }
    })

    function initIndexedDB() {
        return new Promise((resolve, reject) => {
            var obs_g = {
                //general
                lastTx: {},
                //supernode (cloud list)
                supernodes: {}
            }
            var obs_a = {
                //login credentials
                credentials: {},
                //for Dapps
                subAdmins: {},
                trustedIDs: {},
                settings: {},
                appObjects: {},
                generalData: {},
                lastVC: {}
            }
            //add other given objectStores
            initIndexedDB.appObs = initIndexedDB.appObs || {}
            for (let o in initIndexedDB.appObs)
                if (!(o in obs_a))
                    obs_a[o] = initIndexedDB.appObs[o]
            Promise.all([
                compactIDB.initDB(DEFAULT.application, obs_a),
                compactIDB.initDB(DEFAULT.root, obs_g)
            ]).then(result => {
                compactIDB.setDefaultDB(DEFAULT.application)
                resolve("IndexedDB App Storage Initated Successfully")
            }).catch(error => reject(error));
        })
    }

    function initUserDB() {
        return new Promise((resolve, reject) => {
            var obs = {
                contacts: {},
                pubKeys: {},
                messages: {}
            }
            compactIDB.initDB(user.db_name, obs).then(result => {
                resolve("UserDB Initated Successfully")
            }).catch(error => reject('Init userDB failed'));
        })
    }

    function loadUserDB() {
        return new Promise((resolve, reject) => {
            var loadData = ["contacts", "pubKeys", "messages"]
            var promises = []
            for (var i = 0; i < loadData.length; i++)
                promises[i] = compactIDB.readAllData(loadData[i], user.db_name)
            Promise.all(promises).then(results => {
                for (var i = 0; i < loadData.length; i++)
                    user[loadData[i]] = results[i]
                resolve("Loaded Data from userDB")
            }).catch(error => reject('Load userDB failed'))
        })
    }

    const startUpOptions = {
        cloud: true,
        app_config: true,
    }

    floDapps.startUpOptions = {
        set app_config(val) {
            if (val === true || val === false)
                startUpOptions.app_config = val;
        },
        get app_config() { return startUpOptions.app_config },

        set cloud(val) {
            if (val === true || val === false)
                startUpOptions.cloud = val;
        },
        get cloud() { return startUpOptions.cloud },
    }

    const startUpFunctions = [];

    startUpFunctions.push(function readSupernodeListFromAPI() {
        return new Promise((resolve, reject) => {
            if (!startUpOptions.cloud)
                return resolve("No cloud for this app");
            const CLOUD_KEY = "floCloudAPI#" + floCloudAPI.SNStorageID;
            compactIDB.readData("lastTx", CLOUD_KEY, DEFAULT.root).then(lastTx => {
                var query_options = { sentOnly: true, pattern: floCloudAPI.SNStorageName };
                if (typeof lastTx == 'number')  //lastTx is tx count (*backward support)
                    query_options.ignoreOld = lastTx;
                else if (typeof lastTx == 'string') //lastTx is txid of last tx
                    query_options.after = lastTx;
                //fetch data from flosight
                floBlockchainAPI.readData(floCloudAPI.SNStorageID, query_options).then(result => {
                    compactIDB.readData("supernodes", CLOUD_KEY, DEFAULT.root).then(nodes => {
                        nodes = nodes || {};
                        for (var i = result.data.length - 1; i >= 0; i--) {
                            var content = JSON.parse(result.data[i])[floCloudAPI.SNStorageName];
                            for (let sn in content.removeNodes)
                                delete nodes[sn];
                            for (let sn in content.newNodes)
                                nodes[sn] = content.newNodes[sn];
                            for (let sn in content.updateNodes)
                                if (sn in nodes) //check if node is listed
                                    nodes[sn].uri = content.updateNodes[sn];
                        }
                        Promise.all([
                            compactIDB.writeData("lastTx", result.lastItem, CLOUD_KEY, DEFAULT.root),
                            compactIDB.writeData("supernodes", nodes, CLOUD_KEY, DEFAULT.root)
                        ]).then(_ => {
                            floCloudAPI.init(nodes)
                                .then(result => resolve("Loaded Supernode list\n" + result))
                                .catch(error => reject(error))
                        }).catch(error => reject(error))
                    }).catch(error => reject(error))
                })
            }).catch(error => reject(error))
        })
    });

    startUpFunctions.push(function readAppConfigFromAPI() {
        return new Promise((resolve, reject) => {
            if (!startUpOptions.app_config)
                return resolve("No configs for this app");
            compactIDB.readData("lastTx", `${DEFAULT.application}|${DEFAULT.adminID}`, DEFAULT.root).then(lastTx => {
                var query_options = { sentOnly: true, pattern: DEFAULT.application };
                if (typeof lastTx == 'number')  //lastTx is tx count (*backward support)
                    query_options.ignoreOld = lastTx;
                else if (typeof lastTx == 'string') //lastTx is txid of last tx
                    query_options.after = lastTx;
                //fetch data from flosight               
                floBlockchainAPI.readData(DEFAULT.adminID, query_options).then(result => {
                    for (var i = result.data.length - 1; i >= 0; i--) {
                        var content = JSON.parse(result.data[i])[DEFAULT.application];
                        if (!content || typeof content !== "object")
                            continue;
                        if (Array.isArray(content.removeSubAdmin))
                            for (var j = 0; j < content.removeSubAdmin.length; j++)
                                compactIDB.removeData("subAdmins", content.removeSubAdmin[j]);
                        if (Array.isArray(content.addSubAdmin))
                            for (var k = 0; k < content.addSubAdmin.length; k++)
                                compactIDB.writeData("subAdmins", true, content.addSubAdmin[k]);
                        if (Array.isArray(content.removeTrustedID))
                            for (var j = 0; j < content.removeTrustedID.length; j++)
                                compactIDB.removeData("trustedIDs", content.removeTrustedID[j]);
                        if (Array.isArray(content.addTrustedID))
                            for (var k = 0; k < content.addTrustedID.length; k++)
                                compactIDB.writeData("trustedIDs", true, content.addTrustedID[k]);
                        if (content.settings)
                            for (let l in content.settings)
                                compactIDB.writeData("settings", content.settings[l], l)
                    }
                    compactIDB.writeData("lastTx", result.lastItem, `${DEFAULT.application}|${DEFAULT.adminID}`, DEFAULT.root);
                    compactIDB.readAllData("subAdmins").then(result => {
                        subAdmins = Object.keys(result);
                        compactIDB.readAllData("trustedIDs").then(result => {
                            trustedIDs = Object.keys(result);
                            compactIDB.readAllData("settings").then(result => {
                                settings = result;
                                resolve("Read app configuration from blockchain");
                            })
                        })
                    })
                })
            }).catch(error => reject(error))
        })
    });

    startUpFunctions.push(function loadDataFromAppIDB() {
        return new Promise((resolve, reject) => {
            if (!startUpOptions.cloud)
                return resolve("No cloud for this app");
            var loadData = ["appObjects", "generalData", "lastVC"]
            var promises = []
            for (var i = 0; i < loadData.length; i++)
                promises[i] = compactIDB.readAllData(loadData[i])
            Promise.all(promises).then(results => {
                for (var i = 0; i < loadData.length; i++)
                    floGlobals[loadData[i]] = results[i]
                resolve("Loaded Data from app IDB")
            }).catch(error => reject(error))
        })
    });

    var keyInput = type => new Promise((resolve, reject) => {
        let inputVal = prompt(`Enter ${type}: `)
        if (inputVal === null)
            reject(null)
        else
            resolve(inputVal)
    });

    function getCredentials() {

        const readSharesFromIDB = indexArr => new Promise((resolve, reject) => {
            var promises = []
            for (var i = 0; i < indexArr.length; i++)
                promises.push(compactIDB.readData('credentials', indexArr[i]))
            Promise.all(promises).then(shares => {
                var secret = floCrypto.retrieveShamirSecret(shares)
                if (secret)
                    resolve(secret)
                else
                    reject("Shares are insufficient or incorrect")
            }).catch(error => {
                clearCredentials();
                location.reload();
            })
        });

        const writeSharesToIDB = (shares, i = 0, resultIndexes = []) => new Promise(resolve => {
            if (i >= shares.length)
                return resolve(resultIndexes)
            var n = floCrypto.randInt(0, 100000)
            compactIDB.addData("credentials", shares[i], n).then(res => {
                resultIndexes.push(n)
                writeSharesToIDB(shares, i + 1, resultIndexes)
                    .then(result => resolve(result))
            }).catch(error => {
                writeSharesToIDB(shares, i, resultIndexes)
                    .then(result => resolve(result))
            })
        });

        const getPrivateKeyCredentials = () => new Promise((resolve, reject) => {
            var indexArr = localStorage.getItem(`${DEFAULT.application}#privKey`)
            if (indexArr) {
                readSharesFromIDB(JSON.parse(indexArr))
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            } else {
                var privKey;
                keyInput("PRIVATE_KEY").then(result => {
                    if (!result)
                        return reject("Empty Private Key")
                    var floID = floCrypto.getFloID(result)
                    if (!floID || !floCrypto.validateFloID(floID))
                        return reject("Invalid Private Key")
                    privKey = result;
                }).catch(error => {
                    console.log(error, "Generating Random Keys")
                    privKey = floCrypto.generateNewID().privKey
                }).finally(_ => {
                    if (!privKey)
                        return;
                    var threshold = floCrypto.randInt(10, 20)
                    var shares = floCrypto.createShamirsSecretShares(privKey, threshold, threshold)
                    writeSharesToIDB(shares).then(resultIndexes => {
                        //store index keys in localStorage
                        localStorage.setItem(`${DEFAULT.application}#privKey`, JSON.stringify(resultIndexes))
                        //also add a dummy privatekey to the IDB
                        var randomPrivKey = floCrypto.generateNewID().privKey
                        var randomThreshold = floCrypto.randInt(10, 20)
                        var randomShares = floCrypto.createShamirsSecretShares(randomPrivKey, randomThreshold, randomThreshold)
                        writeSharesToIDB(randomShares)
                        //resolve private Key
                        resolve(privKey)
                    })
                })
            }
        });

        const checkIfPinRequired = key => new Promise((resolve, reject) => {
            if (key.length == 52)
                resolve(key)
            else {
                keyInput("PIN/Password").then(pwd => {
                    try {
                        let privKey = Crypto.AES.decrypt(key, pwd);
                        resolve(privKey)
                    } catch (error) {
                        reject("Access Denied: Incorrect PIN/Password")
                    }
                }).catch(error => reject("Access Denied: PIN/Password required"))
            }
        });

        return new Promise((resolve, reject) => {
            getPrivateKeyCredentials().then(key => {
                checkIfPinRequired(key).then(privKey => {
                    try {
                        user_public = floCrypto.getPubKeyHex(privKey);
                        user_id = floCrypto.getAddress(privKey);

                        // Derive Login ID based on Private Key Type
                        try {
                            if (privKey.length === 64) { // Hex Key -> Ethereum
                                if (typeof floEthereum !== 'undefined' && floEthereum.ethAddressFromPrivateKey) {
                                    user_loginID = floEthereum.ethAddressFromPrivateKey(privKey);
                                }
                            } else { // WIF Key
                                let decode = bitjs.Base58.decode(privKey);
                                let version = decode[0];
                                switch (version) {
                                    case 128: // BTC (Mainnet WIF)
                                    case 0: // BTC (Address Version - fallback)
                                        if (typeof btcOperator !== 'undefined')
                                            user_loginID = new Bitcoin.ECKey(privKey).getBitcoinAddress();
                                        break;
                                    case 176: // LTC (Mainnet WIF)
                                    case 48: // LTC (Address Version - fallback)
                                        if (typeof convertWIFtoLitecoinAddress === 'function')
                                            user_loginID = convertWIFtoLitecoinAddress(privKey);
                                        break;
                                    case 163: // FLO (Mainnet WIF 0xA3)
                                    case 35: // FLO (Address Version)
                                        user_loginID = user_id;
                                        break;
                                    case 158: // DOGE (Mainnet WIF 0x9E)
                                    case 30: // DOGE (Address Version) 
                                        if (typeof convertWIFtoDogeAddress === 'function')
                                            user_loginID = convertWIFtoDogeAddress(privKey);
                                        break;
                                }
                                // Manual overrides/checks for keys that might not match standard WIF versions or rely on library detection
                                if (!user_loginID) {
                                    // Try XRP
                                    if (typeof convertWIFtoXrpAddress === 'function') {
                                        let xrpAddr = convertWIFtoXrpAddress(privKey);
                                        if (xrpAddr) user_loginID = xrpAddr;
                                    }
                                }
                            }
                        } catch (e) {
                            console.error("Login ID derivation failed:", e);
                        }
                        if (!user_loginID) user_loginID = user_id; // Fallback

                        if (startUpOptions.cloud) {
                            // Ensure we pass a format floCloudAPI/floCrypto accepts.
                            // For DOGE/LTC WIFs, Bitcoin.ECKey might reject the version byte if gloabls aren't set.
                            // safer to pass RAW HEX Private Key to floCloudAPI.
                            let cloudPrivKey = privKey;
                            try {
                                if (privKey.length > 50 && typeof bitjs !== 'undefined') { // valid WIF length check
                                    let decode = bitjs.Base58.decode(privKey);
                                    if (decode && decode.length) {
                                        // Remove 4-byte checksum
                                        let raw = decode.slice(0, decode.length - 4);
                                        // Remove 1-byte Version
                                        raw.shift();
                                        // Check compression flag (last byte 0x01) if length is 33
                                        if (raw.length === 33 && raw[32] === 1) {
                                            raw.pop();
                                        }
                                        // Convert to Hex
                                        if (raw.length === 32)
                                            cloudPrivKey = Crypto.util.bytesToHex(raw);
                                    }
                                }
                            } catch (e) {
                                console.warn("WIF decode for cloud failed, using original:", e);
                            }
                            floCloudAPI.user(user_loginID, cloudPrivKey);
                        }


                        user_priv_wrap = () => checkIfPinRequired(key);
                        let n = floCrypto.randInt(12, 20);
                        aes_key = floCrypto.randString(n);
                        user_priv_raw = Crypto.AES.encrypt(privKey, aes_key);
                        user_private = user_priv_wrap;
                        resolve('Login Credentials loaded successful')
                    } catch (error) {
                        console.log(error)
                        reject("Corrupted Private Key")
                    }
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    var startUpLog = (status, log) => status ? console.log(log) : console.error(log);

    const callStartUpFunction = i => new Promise((resolve, reject) => {
        startUpFunctions[i]().then(result => {
            callStartUpFunction.completed += 1;
            startUpLog(true, `${result}\nCompleted ${callStartUpFunction.completed}/${callStartUpFunction.total} Startup functions`)
            resolve(true)
        }).catch(error => {
            callStartUpFunction.failed += 1;
            startUpLog(false, `${error}\nFailed ${callStartUpFunction.failed}/${callStartUpFunction.total} Startup functions`)
            reject(false)
        })
    });

    var _midFunction;
    const midStartUp = () => new Promise((res, rej) => {
        if (_midFunction instanceof Function) {
            _midFunction()
                .then(r => res("Mid startup function completed"))
                .catch(e => rej("Mid startup function failed"))
        } else
            res("No mid startup function")
    });

    const callAndLog = p => new Promise((res, rej) => {
        p.then(r => {
            startUpLog(true, r)
            res(r)
        }).catch(e => {
            startUpLog(false, e)
            rej(e)
        })
    });

    floDapps.launchStartUp = function () {
        return new Promise((resolve, reject) => {
            initIndexedDB().then(log => {
                console.log(log)
                callStartUpFunction.total = startUpFunctions.length;
                callStartUpFunction.completed = 0;
                callStartUpFunction.failed = 0;
                let p1 = new Promise((res, rej) => {
                    Promise.all(startUpFunctions.map((f, i) => callStartUpFunction(i))).then(r => {
                        callAndLog(midStartUp())
                            .then(r => res(true))
                            .catch(e => rej(false))
                    })
                });
                let p2 = new Promise((res, rej) => {
                    callAndLog(getCredentials()).then(r => {
                        callAndLog(initUserDB()).then(r => {
                            callAndLog(loadUserDB())
                                .then(r => res(true))
                                .catch(e => rej(false))
                        }).catch(e => rej(false))
                    }).catch(e => rej(false))
                })
                Promise.all([p1, p2])
                    .then(r => resolve('App Startup finished successful'))
                    .catch(e => reject('App Startup failed'))
            }).catch(error => {
                startUpLog(false, error);
                reject("App database initiation failed")
            })
        })
    }

    floDapps.addStartUpFunction = fn => fn instanceof Function && !startUpFunctions.includes(fn) ? startUpFunctions.push(fn) : false;

    floDapps.setMidStartup = fn => fn instanceof Function ? _midFunction = fn : false;

    floDapps.setCustomStartupLogger = fn => fn instanceof Function ? startUpLog = fn : false;

    floDapps.setCustomPrivKeyInput = fn => fn instanceof Function ? keyInput = fn : false;

    floDapps.setAppObjectStores = appObs => initIndexedDB.appObs = appObs;

    floDapps.storeContact = function (floID, name) {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateAddr(floID))
                return reject("Invalid floID!")
            compactIDB.writeData("contacts", name, floID, user.db_name).then(result => {
                user.contacts[floID] = name;
                resolve("Contact stored")
            }).catch(error => reject(error))
        });
    }

    floDapps.storePubKey = function (floID, pubKey) {
        return new Promise((resolve, reject) => {
            if (floID in user.pubKeys)
                return resolve("pubKey already stored")
            if (!floCrypto.validateAddr(floID))
                return reject("Invalid floID!")
            if (!floCrypto.verifyPubKey(pubKey, floID))
                return reject("Incorrect pubKey")
            compactIDB.writeData("pubKeys", pubKey, floID, user.db_name).then(result => {
                user.pubKeys[floID] = pubKey;
                resolve("pubKey stored")
            }).catch(error => reject(error))
        });
    }

    floDapps.sendMessage = function (floID, message) {
        return new Promise((resolve, reject) => {
            let options = {
                receiverID: floID,
                application: DEFAULT.root,
                comment: DEFAULT.application
            }
            if (floID in user.pubKeys)
                message = floCrypto.encryptData(JSON.stringify(message), user.pubKeys[floID])
            floCloudAPI.sendApplicationData(message, "Message", options)
                .then(result => resolve(result))
                .catch(error => reject(error))
        })
    }

    floDapps.requestInbox = function (callback) {
        return new Promise((resolve, reject) => {
            let lastVC = Object.keys(user.messages).sort().pop()
            let options = {
                receiverID: user.id,
                application: DEFAULT.root,
                lowerVectorClock: lastVC + 1
            }
            let privKey = raw_user.private;
            options.callback = (d, e) => {
                for (let v in d) {
                    try {
                        if (d[v].message instanceof Object && "secret" in d[v].message)
                            d[v].message = floCrypto.decryptData(d[v].message, privKey)
                    } catch (error) { }
                    compactIDB.writeData("messages", d[v], v, user.db_name)
                    user.messages[v] = d[v]
                }
                if (callback instanceof Function)
                    callback(d, e)
            }
            floCloudAPI.requestApplicationData("Message", options)
                .then(result => resolve(result))
                .catch(error => reject(error))
        })
    }

    floDapps.manageAppConfig = function (adminPrivKey, addList, rmList, settings) {
        return new Promise((resolve, reject) => {
            if (!startUpOptions.app_config)
                return reject("No configs for this app");
            if (!Array.isArray(addList) || !addList.length) addList = undefined;
            if (!Array.isArray(rmList) || !rmList.length) rmList = undefined;
            if (!settings || typeof settings !== "object" || !Object.keys(settings).length) settings = undefined;
            if (!addList && !rmList && !settings)
                return reject("No configuration change")
            var floData = {
                [DEFAULT.application]: {
                    addSubAdmin: addList,
                    removeSubAdmin: rmList,
                    settings: settings
                }
            }
            var floID = floCrypto.getFloID(adminPrivKey)
            if (floID != DEFAULT.adminID)
                reject('Access Denied for Admin privilege')
            else
                floBlockchainAPI.writeData(floID, JSON.stringify(floData), adminPrivKey)
                    .then(result => resolve(['Updated App Configuration', result]))
                    .catch(error => reject(error))
        })
    }

    floDapps.manageAppTrustedIDs = function (adminPrivKey, addList, rmList) {
        return new Promise((resolve, reject) => {
            if (!startUpOptions.app_config)
                return reject("No configs for this app");
            if (!Array.isArray(addList) || !addList.length) addList = undefined;
            if (!Array.isArray(rmList) || !rmList.length) rmList = undefined;
            if (!addList && !rmList)
                return reject("No change in list")
            var floData = {
                [DEFAULT.application]: {
                    addTrustedID: addList,
                    removeTrustedID: rmList
                }
            }
            var floID = floCrypto.getFloID(adminPrivKey)
            if (floID != DEFAULT.adminID)
                reject('Access Denied for Admin privilege')
            else
                floBlockchainAPI.writeData(floID, JSON.stringify(floData), adminPrivKey)
                    .then(result => resolve(['Updated App Configuration', result]))
                    .catch(error => reject(error))
        })
    }

    const clearCredentials = floDapps.clearCredentials = function () {
        return new Promise((resolve, reject) => {
            compactIDB.clearData('credentials', DEFAULT.application).then(result => {
                localStorage.removeItem(`${DEFAULT.application}#privKey`);
                user.clear();
                resolve("privKey credentials deleted!")
            }).catch(error => reject(error))
        })
    }

    floDapps.deleteUserData = function (credentials = false) {
        return new Promise((resolve, reject) => {
            let p = []
            p.push(compactIDB.deleteDB(user.db_name))
            if (credentials)
                p.push(clearCredentials())
            Promise.all(p)
                .then(result => resolve('User database(local) deleted'))
                .catch(error => reject(error))
        })
    }

    floDapps.deleteAppData = function () {
        return new Promise((resolve, reject) => {
            compactIDB.deleteDB(DEFAULT.application).then(result => {
                localStorage.removeItem(`${DEFAULT.application}#privKey`)
                user.clear();
                compactIDB.removeData('lastTx', `${DEFAULT.application}|${DEFAULT.adminID}`, DEFAULT.root)
                    .then(result => resolve("App database(local) deleted"))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    floDapps.securePrivKey = function (pwd) {
        return new Promise(async (resolve, reject) => {
            let indexArr = localStorage.getItem(`${DEFAULT.application}#privKey`)
            if (!indexArr)
                return reject("PrivKey not found");
            indexArr = JSON.parse(indexArr)
            let encryptedKey = Crypto.AES.encrypt(await user.private, pwd);
            let threshold = indexArr.length;
            let shares = floCrypto.createShamirsSecretShares(encryptedKey, threshold, threshold)
            let promises = [];
            let overwriteFn = (share, index) =>
                compactIDB.writeData("credentials", share, index, DEFAULT.application);
            for (var i = 0; i < threshold; i++)
                promises.push(overwriteFn(shares[i], indexArr[i]));
            Promise.all(promises)
                .then(results => resolve("Private Key Secured"))
                .catch(error => reject(error))
        })
    }

    floDapps.verifyPin = function (pin = null) {
        const readSharesFromIDB = function (indexArr) {
            return new Promise((resolve, reject) => {
                var promises = []
                for (var i = 0; i < indexArr.length; i++)
                    promises.push(compactIDB.readData('credentials', indexArr[i]))
                Promise.all(promises).then(shares => {
                    var secret = floCrypto.retrieveShamirSecret(shares)
                    console.info(shares, secret)
                    if (secret)
                        resolve(secret)
                    else
                        reject("Shares are insufficient or incorrect")
                }).catch(error => {
                    clearCredentials();
                    location.reload();
                })
            })
        }
        return new Promise((resolve, reject) => {
            var indexArr = localStorage.getItem(`${DEFAULT.application}#privKey`)
            console.info(indexArr)
            if (!indexArr)
                reject('No login credentials found')
            readSharesFromIDB(JSON.parse(indexArr)).then(key => {
                if (key.length == 52) {
                    if (pin === null)
                        resolve("Private key not secured")
                    else
                        reject("Private key not secured")
                } else {
                    if (pin === null)
                        return reject("PIN/Password required")
                    try {
                        let privKey = Crypto.AES.decrypt(key, pin);
                        resolve("PIN/Password verified")
                    } catch (error) {
                        reject("Incorrect PIN/Password")
                    }
                }
            }).catch(error => reject(error))
        })
    }

    const getNextGeneralData = floDapps.getNextGeneralData = function (type, vectorClock = null, options = {}) {
        var fk = floCloudAPI.util.filterKey(type, options)
        vectorClock = vectorClock || getNextGeneralData[fk] || '0';
        var filteredResult = {}
        if (floGlobals.generalData[fk]) {
            for (let d in floGlobals.generalData[fk])
                if (d > vectorClock)
                    filteredResult[d] = JSON.parse(JSON.stringify(floGlobals.generalData[fk][d]))
        } else if (options.comment) {
            let comment = options.comment;
            delete options.comment;
            let fk = floCloudAPI.util.filterKey(type, options);
            for (let d in floGlobals.generalData[fk])
                if (d > vectorClock && floGlobals.generalData[fk][d].comment == comment)
                    filteredResult[d] = JSON.parse(JSON.stringify(floGlobals.generalData[fk][d]))
        }
        if (options.decrypt) {
            let decryptionKey = (options.decrypt === true) ? raw_user.private : options.decrypt;
            if (!Array.isArray(decryptionKey))
                decryptionKey = [decryptionKey];
            for (let f in filteredResult) {
                let data = filteredResult[f]
                try {
                    if (data.message instanceof Object && "secret" in data.message) {
                        for (let key of decryptionKey) {
                            try {
                                let tmp = floCrypto.decryptData(data.message, key)
                                data.message = JSON.parse(tmp)
                                break;
                            } catch (error) { }
                        }
                    }
                } catch (error) { }
            }
        }
        getNextGeneralData[fk] = Object.keys(filteredResult).sort().pop();
        return filteredResult;
    }

    const syncData = floDapps.syncData = {};

    syncData.oldDevice = () => new Promise((resolve, reject) => {
        let sync = {
            contacts: user.contacts,
            pubKeys: user.pubKeys,
            messages: user.messages
        }
        let message = Crypto.AES.encrypt(JSON.stringify(sync), raw_user.private)
        let options = {
            receiverID: user.id,
            application: DEFAULT.root
        }
        floCloudAPI.sendApplicationData(message, "syncData", options)
            .then(result => resolve(result))
            .catch(error => reject(error))
    });

    syncData.newDevice = () => new Promise((resolve, reject) => {
        var options = {
            receiverID: user.id,
            senderID: user.id,
            application: DEFAULT.root,
            mostRecent: true,
        }
        floCloudAPI.requestApplicationData("syncData", options).then(response => {
            let vc = Object.keys(response).sort().pop()
            let sync = JSON.parse(Crypto.AES.decrypt(response[vc].message, raw_user.private))
            let promises = []
            let store = (key, val, obs) => promises.push(compactIDB.writeData(obs, val, key, user.db_name));
            ["contacts", "pubKeys", "messages"].forEach(c => {
                for (let i in sync[c]) {
                    store(i, sync[c][i], c)
                    user[c][i] = sync[c][i]
                }
            })
            Promise.all(promises)
                .then(results => resolve("Sync data successful"))
                .catch(error => reject(error))
        }).catch(error => reject(error))
    });
})('object' === typeof module ? module.exports : window.floDapps = {});