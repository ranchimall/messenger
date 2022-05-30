(function() {
    const messenger = window.messenger = {};

    function sendRaw(message, recipient, type, encrypt = null, comment = undefined) {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateAddr(recipient))
                return reject("Invalid Recipient floID");

            if ([true, null].includes(encrypt) && recipient in floGlobals.pubKeys)
                message = floCrypto.encryptData(message, floGlobals.pubKeys[recipient])
            else if (encrypt === true)
                return reject("recipient's pubKey not found")
            let options = {
                receiverID: recipient,
            }
            if (comment)
                options.comment = comment
            floCloudAPI.sendApplicationData(message, type, options)
                .then(result => resolve(result))
                .catch(error => reject(error))
        })
    }

    function encrypt(value, key = floGlobals.appendix.AESKey) {
        return Crypto.AES.encrypt(value, key)
    }

    function decrypt(value, key = floGlobals.appendix.AESKey) {
        return Crypto.AES.decrypt(value, key)
    }

    function addMark(key, mark) {
        return new Promise((resolve, reject) => {
            compactIDB.readData("marked", key).then(result => {
                if (!result)
                    result = [mark];
                else if (!result.includes(mark))
                    result.push(mark);
                else
                    return resolve("Mark already exist");
                compactIDB.writeData("marked", result, key)
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    function removeMark(key, mark) {
        return new Promise((resolve, reject) => {
            compactIDB.readData("marked", key).then(result => {
                if (!result || !result.includes(mark))
                    return resolve("Mark doesnot exist")
                else {
                    result.splice(result.indexOf(mark),
                        1); //remove the mark from the list of marks
                    compactIDB.writeData("marked", result, key)
                        .then(result => resolve("Mark removed"))
                        .catch(error => reject(error))
                }
            }).catch(error => reject(error))
        })
    }

    const UIcallback = {
        group: (d, e) => console.log(d, e),
        direct: (d, e) => console.log(d, e)
    }

    function groupConn(groupID) {
        console.debug(UIcallback);
        let callbackFn = function(dataSet, error) {
            if (error)
                return console.error(error)
            console.info(dataSet)
            let newInbox = {
                messages: {}
            }
            let infoChange = false;
            for (let vc in dataSet) {
                if (groupID !== dataSet[vc].receiverID ||
                    !floGlobals.groups[groupID].members.includes(dataSet[vc].senderID))
                    continue;
                try {
                    let data = {
                        time: dataSet[vc].time,
                        sender: dataSet[vc].senderID,
                        groupID: dataSet[vc].receiverID
                    }
                    let k = floGlobals.groups[groupID].eKey;
                    if (floGlobals.expiredKeys[groupID]) {
                        var ex = Object.keys(floGlobals.expiredKeys[groupID]).sort()
                        while (ex.lenght && vc > ex[0]) ex.shift()
                        if (ex.length)
                            k = floGlobals.expiredKeys[groupID][ex.shift()]
                    }
                    dataSet[vc].message = decrypt(dataSet[vc].message, k)
                    //store the pubKey if not stored already
                    floDapps.storePubKey(dataSet[vc].senderID, dataSet[vc].pubKey)
                    if (dataSet[vc].type === "GROUP_MSG")
                        data.message = encrypt(dataSet[vc].message);
                    else if (data.sender === floGlobals.groups[groupID].admin) {
                        let groupInfo = floGlobals.groups[groupID]
                        data.admin = true;
                        if (dataSet[vc].type === "ADD_MEMBERS") {
                            data.newMembers = dataSet[vc].message.split("|")
                            data.note = dataSet[vc].comment
                            groupInfo.members = [...new Set(groupInfo.members.concat(data
                                .newMembers))]
                        } else if (dataSet[vc].type === "RM_MEMBERS") {
                            data.rmMembers = dataSet[vc].message.split("|")
                            data.note = dataSet[vc].comment
                            groupInfo.members = groupInfo.members.filter(m => !data.rmMembers
                                .includes(m))
                            if (data.rmMembers.includes(myFloID))
                                groupInfo.status = false
                        } else if (dataSet[vc].type === "UP_DESCRIPTION") {
                            data.description = dataSet[vc].message
                            groupInfo.description = data.description
                        } else if (dataSet[vc].type === "UP_NAME") {
                            data.name = dataSet[vc].message
                            groupInfo.name = data.name
                        }
                        infoChange = true;
                    }
                    compactIDB.addData("messages", {
                        ...data
                    }, `${groupID}|${vc}`)
                    if (data.message)
                        data.message = decrypt(data.message);
                    newInbox.messages[vc] = data;
                    console.log(data)
                    if (data.sender !== myFloID)
                        addMark(data.groupID, "unread")
                    if (!floGlobals.appendix[`lastReceived_${groupID}`] ||
                        floGlobals.appendix[`lastReceived_${groupID}`] < vc)
                        floGlobals.appendix[`lastReceived_${groupID}`] = vc;
                } catch (error) {
                    console.log(error)
                }
            }
            compactIDB.writeData("appendix", floGlobals.appendix[`lastReceived_${groupID}`],
                `lastReceived_${groupID}`);
            if (infoChange) {
                let newInfo = {
                    ...floGlobals.groups[groupID]
                }
                newInfo.eKey = encrypt(newInfo.eKey)
                compactIDB.writeData("groups", newInfo, groupID)
            }
            console.debug(newInbox);
            UIcallback.group(newInbox);
        }
        return floCloudAPI.requestApplicationData(null, {
            receiverID: groupID,
            lowerVectorClock: floGlobals.appendix[`lastReceived_${groupID}`] + 1,
            callback: callbackFn
        })
    }

    messenger.setUIcallbacks = function(directUI = null, groupUI = null) {
        if (directUI instanceof Function)
            UIcallback["direct"] = directUI
        if (groupUI instanceof Function)
            UIcallback["group"] = groupUI
    }

    messenger.initUserDB = function() {
        return new Promise((resolve, reject) => {
            var obj = {
                messages: {},
                mails: {},
                marked: {},
                chats: {},
                groups: {},
                gkeys: {},
                appendix: {},
                userSettings: {}
            }
            compactIDB.initDB(`${floGlobals.application}_${myFloID}`, obj).then(result => {
                console.info(result)
                compactIDB.setDefaultDB(`${floGlobals.application}_${myFloID}`);
                resolve("Messenger UserDB Initated Successfully")
            }).catch(error => reject(error));
        })
    }

    messenger.sendMessage = function(message, receiver) {
        return new Promise(async (resolve, reject) => {
            sendRaw(message, receiver, "MESSAGE").then(result => {
                let vc = result.vectorClock;
                let data = {
                    floID: receiver,
                    time: result.time,
                    category: 'sent',
                    message: encrypt(message)
                }
                floGlobals.chats[receiver] = parseInt(vc)
                compactIDB.writeData("chats", parseInt(vc), receiver)
                compactIDB.addData("messages", {
                    ...data
                }, `${receiver}|${vc}`)
                data.message = message;
                resolve({
                    [vc]: data
                });
            }).catch(error => reject(error))
        })
    }

    messenger.sendMail = function(subject, content, recipients, prev = null) {
        return new Promise(async (resolve, reject) => {
            if (!Array.isArray(recipients))
                recipients = [recipients]
            let mail = {
                subject: subject,
                content: content,
                ref: Date.now() + floCrypto.randString(8, true),
                prev: prev
            }
            let promises = recipients.map(r => sendRaw(JSON.stringify(mail), r, "MAIL"))
            Promise.allSettled(promises).then(results => {
                mail.time = Date.now();
                mail.from = myFloID
                mail.to = []
                results.forEach(r => {
                    if (r.status === "fulfilled")
                        mail.to.push(r.value.receiverID)
                });
                if (mail.to.length === 0)
                    return reject(results)
                mail.content = encrypt(content)
                compactIDB.addData("mails", {
                    ...mail
                }, mail.ref)
                mail.content = content
                resolve({
                    [mail.ref]: mail
                });
            })
        })
    }

    messenger.requestDirectInbox = function() {
        return new Promise((resolve, reject) => {
            let callbackFn = function(dataSet, error) {
                if (error)
                    return console.error(error)
                let newInbox = {
                    messages: {},
                    mails: {},
                    newgroups: [],
                    keyrevoke: []
                }
                console.log(dataSet)
                for (let vc in dataSet) {
                    try {
                        //store the pubKey if not stored already
                        floDapps.storePubKey(dataSet[vc].senderID, dataSet[vc].pubKey)
                        if (dataSet[vc].message instanceof Object && "secret" in dataSet[vc].message)
                            dataSet[vc].message = floCrypto.decryptData(dataSet[vc].message, myPrivKey)
                        if (dataSet[vc].type === "MESSAGE") {
                            //process as message
                            let dm = {
                                time: dataSet[vc].time,
                                floID: dataSet[vc].senderID,
                                category: "received",
                                message: encrypt(dataSet[vc].message)
                            }
                            compactIDB.addData("messages", {
                                ...dm
                            }, `${dm.floID}|${vc}`)
                            floGlobals.chats[dm.floID] = parseInt(vc)
                            compactIDB.writeData("chats", parseInt(vc), dm.floID)
                            dm.message = dataSet[vc].message;
                            newInbox.messages[vc] = dm;
                            addMark(dm.floID, "unread")
                        } else if (dataSet[vc].type === "MAIL") {
                            //process as mail
                            let data = JSON.parse(dataSet[vc].message);
                            let mail = {
                                time: dataSet[vc].time,
                                from: dataSet[vc].senderID,
                                to: [myFloID],
                                subject: data.subject,
                                content: encrypt(data.content),
                                ref: data.ref,
                                prev: data.prev
                            }
                            compactIDB.addData("mails", {
                                ...mail
                            }, mail.ref);
                            mail.content = data.content;
                            newInbox.mails[mail.ref] = mail;
                            addMark(mail.ref, "unread")
                        } else if (dataSet[vc].type === "CREATE_GROUP") {
                            //process create group
                            let groupInfo = JSON.parse(dataSet[vc].message);
                            let h = ["groupID", "created", "admin"].map(x => groupInfo[x]).join('|')
                            if (groupInfo.admin === dataSet[vc].senderID &&
                                floCrypto.verifySign(h, groupInfo.hash, groupInfo.pubKey) &&
                                floCrypto.getFloID(groupInfo.pubKey) === groupInfo.groupID) {
                                let eKey = groupInfo.eKey
                                groupInfo.eKey = encrypt(eKey)
                                compactIDB.writeData("groups", {
                                    ...groupInfo
                                }, groupInfo.groupID)
                                groupInfo.eKey = eKey
                                floGlobals.groups[groupInfo.groupID] = groupInfo
                                groupConn(groupInfo.groupID)
                                newInbox.newgroups.push(groupInfo.groupID)
                            }
                        } else if (dataSet[vc].type === "REVOKE_KEY") {
                            let r = JSON.parse(dataSet[vc].message);
                            let groupInfo = floGlobals.groups[r.groupID]
                            if (dataSet[vc].senderID === groupInfo.admin) {
                                if (typeof floGlobals.expiredKeys[r.groupID] !== "object")
                                    floGlobals.expiredKeys[r.groupID] = {}
                                floGlobals.expiredKeys[r.groupID][vc] = groupInfo.eKey
                                let eKey = r.newKey
                                groupInfo.eKey = encrypt(eKey);
                                compactIDB.writeData("groups", {
                                    ...groupInfo
                                }, groupInfo.groupID)
                                groupInfo.eKey = eKey
                                newInbox.keyrevoke.push(groupInfo.groupID)
                            }
                        }
                    } catch (error) {
                        console.log(error)
                    } finally {
                        if (floGlobals.appendix.lastReceived < vc)
                            floGlobals.appendix.lastReceived = vc;
                    }
                }
                compactIDB.writeData("appendix", floGlobals.appendix.lastReceived, "lastReceived");
                console.debug(newInbox);
                UIcallback.direct(newInbox)
            }

            var options = {
                receiverID: myFloID,
                lowerVectorClock: floGlobals.appendix.lastReceived + 1,
                callback: callbackFn
            }
            floCloudAPI.requestApplicationData(null, options)
                .then(result => resolve(result))
                .catch(error => reject(error))
        })
    }

    messenger.getMail = function(mailRef) {
        return new Promise((resolve, reject) => {
            compactIDB.readData("mails", mailRef).then(mail => {
                mail.content = decrypt(mail.content)
                resolve(mail)
            }).catch(error => reject(error))
        });
    }

    messenger.getChatOrder = function(type = ["direct", "group", "mixed"]) {
        if (typeof type === "string")
            type = type.split('|')
        let result = {}
        if (type.includes("direct"))
            result.direct = Object.keys(floGlobals.chats).map(a => [floGlobals.chats[a], a])
            .sort((a, b) => b[0] - a[0]).map(a => a[1])
        if (type.includes("group"))
            result.group = Object.keys(floGlobals.groups).map(a => [parseInt(floGlobals.appendix[`lastReceived_${a}`]), a])
            .sort((a, b) => b[0] - a[0]).map(a => a[1])
        if (type.includes("mixed"))
            result.mixed = Object.keys(floGlobals.chats).map(a => [floGlobals.chats[a], a])
            .concat(Object.keys(floGlobals.groups).map(a => [parseInt(floGlobals.appendix[`lastReceived_${a}`]), a]))
            .sort((a, b) => b[0] - a[0]).map(a => a[1])
        if (type.length === 1)
            result = result[type[0]]
        return result
    }

    messenger.storeContact = function(floID, name) {
        return floDapps.storeContact(floID, name)
    }

    const loadDataFromIDB = messenger.loadDataFromIDB = function(dataList = 'default') {
        return new Promise((resolve, reject) => {
            if (dataList === 'default')
                dataList = ["mails", "marked", "groups", "chats", "appendix"]
            else if (dataList === 'all')
                dataList = ["messages", "mails", "marked", "chats", "groups", "gkeys", "appendix"]
            let promises = []
            for (var i = 0; i < dataList.length; i++)
                promises[i] = compactIDB.readAllData(dataList[i])
            Promise.all(promises).then(results => {
                let data = {}
                for (var i = 0; i < dataList.length; i++)
                    data[dataList[i]] = results[i]
                data.appendix.lastReceived = data.appendix.lastReceived || '0'
                if (data.appendix.AESKey) {
                    try {
                        let AESKey = floCrypto.decryptData(data.appendix.AESKey, myPrivKey);
                        data.appendix.AESKey = AESKey;
                        if (dataList.includes("messages"))
                            for (let m in data.messages)
                                if (data.messages[m].message)
                                    data.messages[m].message = decrypt(data.messages[m].message, AESKey)
                        if (dataList.includes("mails"))
                            for (let m in data.mails)
                                data.mails[m].content = decrypt(data.mails[m].content, AESKey)
                        if (dataList.includes("groups"))
                            for (let g in data.groups)
                                data.groups[g].eKey = decrypt(data.groups[g].eKey, AESKey)
                        if (dataList.includes("gkeys"))
                            for (let k in data.gkeys)
                                data.gkeys[k] = decrypt(data.gkeys[k], AESKey)
                        resolve(data)
                    } catch (error) {
                        reject("Corrupted AES Key");
                    }
                } else {
                    if (Object.keys(data.mails).length)
                        return reject("AES Key not Found")
                    let AESKey = floCrypto.randString(32);
                    let encryptedKey = floCrypto.encryptData(AESKey, myPubKey);
                    compactIDB.addData("appendix", encryptedKey, "AESKey").then(result => {
                        data.appendix.AESKey = AESKey;
                        resolve(data);
                    }).catch(error => reject("Unable to Generate AES Key"))
                }
            }).catch(error => reject(error))
        })
    }

    messenger.addMark = function(key, mark) {
        if (floGlobals.marked.hasOwnProperty(key) && !floGlobals.marked[key].includes(mark))
            floGlobals.marked[key].push(mark)
        return addMark(key, mark)
    }

    messenger.removeMark = function(key, mark) {
        if (floGlobals.marked.hasOwnProperty(key))
            floGlobals.marked[key] = floGlobals.marked[key].filter(v => v !== mark)
        return removeMark(key, mark)
    }

    messenger.addChat = function(chatID) {
        return new Promise((resolve, reject) => {
            compactIDB.addData("chats", 0, chatID)
                .then(result => resolve("Added chat"))
                .catch(error => reject(error))
        })
    }

    messenger.rmChat = function(chatID) {
        return new Promise((resolve, reject) => {
            compactIDB.removeData("chats", chatID)
                .then(result => resolve("Chat removed"))
                .catch(error => reject(error))
        })
    }

    messenger.clearChat = function(chatID) {
        return new Promise((resolve, reject) => {
            let options = {
                lowerKey: `${chatID}|`,
                upperKey: `${chatID}||`
            }
            compactIDB.searchData("messages", options).then(result => {
                let promises = []
                for (let i in result)
                    promises.push(compactIDB.removeData("messages", i))
                Promise.all(promises)
                    .then(result => resolve("Chat cleared"))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    messenger.getChat = function(chatID) {
        return new Promise((resolve, reject) => {
            let options = {
                lowerKey: `${chatID}|`,
                upperKey: `${chatID}||`
            }
            compactIDB.searchData("messages", options).then(result => {
                for (let i in result)
                    if (result[i].message)
                        result[i].message = decrypt(result[i].message)
                resolve(result)
            }).catch(error => reject(error))
        })
    }

    messenger.backupData = function() {
        return new Promise((resolve, reject) => {
            loadDataFromIDB("all").then(data => {
                delete data.appendix.AESKey;
                data.contacts = floGlobals.contacts;
                data.pubKeys = floGlobals.pubKeys;
                data = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
                let blobData = {
                    floID: myFloID,
                    pubKey: myPubKey,
                    data: encrypt(data, myPrivKey),
                }
                blobData.sign = floCrypto.signData(blobData.data, myPrivKey);
                resolve(new Blob([JSON.stringify(blobData)], {
                    type: 'application/json'
                }));
            }).catch(error => reject(error))
        })
    }

    const parseBackup = messenger.parseBackup = function(blob) {
        return new Promise((resolve, reject) => {
            if (blob instanceof Blob || blob instanceof File) {
                let reader = new FileReader();
                reader.onload = evt => {
                    var blobData = JSON.parse(evt.target.result);
                    if (!floCrypto.verifySign(blobData.data, blobData.sign, blobData.pubKey))
                        reject("Corrupted Backup file: Signature verification failed");
                    else if (myFloID !== blobData.floID || myPubKey !== blobData.pubKey)
                        reject("Invalid Backup file: Incorrect floID");
                    else {
                        try {
                            let data = decrypt(blobData.data, myPrivKey)
                            try {
                                data = JSON.parse(decodeURIComponent(escape(atob(data))));
                                resolve(data)
                            } catch (e) {
                                reject("Corrupted Backup file: Parse failed");
                            }
                        } catch (e) {
                            reject("Corrupted Backup file: Decryption failed");
                        }
                    }
                }
                reader.readAsText(blob);
            } else
                reject("Backup is not a valid File (or) Blob")
        })
    }

    messenger.restoreData = function(arg) {
        return new Promise((resolve, reject) => {
            if (arg instanceof Blob || arg instanceof File)
                var parseData = parseBackup
            else
                var parseData = data => new Promise((res, rej) => res(data))
            parseData(arg).then(data => {
                for (let m in data.messages)
                    if (data.messages[m].message)
                        data.messages[m].message = encrypt(data.messages[m].message)
                for (let m in data.mail)
                    data.mails[m].content = encrypt(data.mails[m].content)
                for (let k in data.gkeys)
                    data.gkeys[k] = encrypt(data.gkeys[k])
                for (let g in data.groups)
                    data.groups[g].eKey = encrypt(data.groups[g].eKey)
                for (let c in data.chats)
                    if (data.chats[c] <= floGlobals.chats[c])
                        delete data.chats[c]
                for (let l in data.appendix)
                    if (l.startsWith('lastReceived') && data.appendix[l] <= floGlobals.appendix[l])
                        delete data.appendix[l]
                for (let c in data.contacts)
                    if (c in floGlobals.contacts)
                        delete data.contact[c]
                for (let p in data.pubKeys)
                    if (p in floGlobals.pubKeys)
                        delete data.pubKeys[p]
                let promises = [];
                for (let obs in data) {
                    let writeFn;
                    switch (obs) {
                        case "contacts":
                            writeFn = (k, v) => floDapps.storeContact(k, v);
                            break;
                        case "pubKeys":
                            writeFn = (k, v) => floDapps.storePubKey(k, v);
                            break;
                        default:
                            writeFn = (k, v) => compactIDB.writeData(obs, v, k);
                            break;
                    }
                    for (let k in data[obs])
                        promises.push(writeFn(k, data[obs][k]));
                }

                Promise.all(promises)
                    .then(results => resolve("Restore Successful"))
                    .catch(error => reject("Restore Failed: Unable to write to IDB"))
            }).catch(error => reject(error))
        })
    }

    messenger.clearUserData = function() {
        return new Promise((resolve, reject) => {
            let promises = [
                compactIDB.deleteDB(),
                floDapps.clearCredentials()
            ]
            Promise.all(promises)
                .then(result => resolve("User Data cleared"))
                .catch(error => reject(error))
        })
    }

    //group feature

    messenger.createGroup = function(groupname, description = '') {
        return new Promise((resolve, reject) => {
            if (!groupname) return reject("Invalid Group Name")
            let id = floCrypto.generateNewID();
            let groupInfo = {
                groupID: id.floID,
                pubKey: id.pubKey,
                admin: myFloID,
                name: groupname,
                description: description,
                created: Date.now(),
                members: [myFloID]
            }
            let h = ["groupID", "created", "admin"].map(x => groupInfo[x]).join('|')
            groupInfo.hash = floCrypto.signData(h, id.privKey)
            let eKey = floCrypto.randString(16, false)
            groupInfo.eKey = encrypt(eKey)
            p1 = compactIDB.addData("groups", groupInfo, id.floID)
            p2 = compactIDB.addData("gkeys", encrypt(id.privKey), id.floID)
            Promise.all([p1, p2]).then(r => {
                groupInfo.eKey = eKey
                floGlobals.groups[id.floID] = groupInfo;
                groupConn(id.floID)
                resolve(groupInfo)
            }).catch(e => reject(e))
        })
    }

    messenger.changeGroupName = function(groupID, name) {
        return new Promise((resolve, reject) => {
            let groupInfo = floGlobals.groups[groupID]
            if (myFloID !== groupInfo.admin)
                return reject("Access denied: Admin only!")
            let message = encrypt(name, groupInfo.eKey)
            sendRaw(message, groupID, "UP_NAME", false)
                .then(result => resolve('Name updated'))
                .catch(error => reject(error))
        })
    }

    messenger.changeGroupDescription = function(groupID, description) {
        return new Promise((resolve, reject) => {
            let groupInfo = floGlobals.groups[groupID]
            if (myFloID !== groupInfo.admin)
                return reject("Access denied: Admin only!")
            let message = encrypt(description, groupInfo.eKey)
            sendRaw(message, groupID, "UP_DESCRIPTION", false)
                .then(result => resolve('Description updated'))
                .catch(error => reject(error))
        })
    }

    messenger.addGroupMembers = function(groupID, newMem, note = undefined) {
        return new Promise((resolve, reject) => {
            if (!Array.isArray(newMem) && typeof newMem === "string")
                newMem = [newMem]
            //check for validity
            let imem1 = [],
                imem2 = []
            newMem.forEach(m =>
                !floCrypto.validateAddr(m) ? imem1.push(m) :
                m in floGlobals.pubKeys ? null : imem2.push(m)
            );
            if (imem1.length)
                return reject(`Invalid Members(floIDs): ${imem1}`)
            else if (imem2.length)
                return reject(`Invalid Members (pubKey not available): ${imem2}`)
            //send new newMem list to existing members
            let groupInfo = floGlobals.groups[groupID]
            if (myFloID !== groupInfo.admin)
                return reject("Access denied: Admin only!")
            //send groupInfo to new newMem
            let k = groupInfo.eKey
            groupInfo = JSON.stringify(groupInfo)
            let promises = newMem.map(m => sendRaw(groupInfo, m, "CREATE_GROUP", true));
            Promise.allSettled(promises).then(results => {
                let success = [],
                    failed = [];
                for (let i in results)
                    if (results[i].status === "fulfilled")
                        success.push(newMem[i])
                else if (results[i].status === "rejected")
                    failed.push(newMem[i])
                console.log(success.join("|"), k)
                let message = encrypt(success.join("|"), k)
                sendRaw(message, groupID, "ADD_MEMBERS", false, note)
                    .then(r => resolve(`Members added: ${success}`))
                    .catch(e => reject(e))
            })
        })
    }

    messenger.rmGroupMembers = function(groupID, rmMem, note = undefined) {
        return new Promise((resolve, reject) => {
            if (!Array.isArray(rmMem) && typeof rmMem === "string")
                rmMem = [rmMem]
            let groupInfo = floGlobals.groups[groupID]
            let imem = rmMem.filter(m => !groupInfo.members.includes(m))
            if (imem.length)
                return reject(`Invalid members: ${imem}`)
            if (myFloID !== groupInfo.admin)
                return reject("Access denied: Admin only!")
            let message = encrypt(rmMem.join("|"), groupInfo.eKey)
            p1 = sendRaw(message, groupID, "RM_MEMBERS", false, note)
            groupInfo.members = groupInfo.members.filter(m => !rmMem.includes(m))
            p2 = revokeKey(groupID)
            Promise.all([p1, p2])
                .then(r => resolve(`Members removed: ${rmMem}`))
                .catch(e => reject(e))
        })
    }

    const revokeKey = messenger.revokeKey = function(groupID) {
        return new Promise((resolve, reject) => {
            let groupInfo = floGlobals.groups[groupID]
            if (myFloID !== groupInfo.admin)
                return reject("Access denied: Admin only!")
            let newKey = floCrypto.randString(16, false);
            Promise.all(groupInfo.members.map(m => sendRaw(JSON.stringify({
                newKey,
                groupID
            }), m, "REVOKE_KEY", true))).then(result => {
                resolve("Group key revoked")
            }).catch(error => reject(error))
        })
    }

    messenger.sendGroupMessage = function(message, groupID) {
        return new Promise(async (resolve, reject) => {
            let k = floGlobals.groups[groupID].eKey
            message = encrypt(message, k)
            sendRaw(message, groupID, "GROUP_MSG", false)
                .then(result => resolve(`${groupID}: ${message}`))
                .catch(error => reject(error))
        })
    }

    messenger.requestGroupInbox = function() {
        return new Promise((resolve) => {
            let promises = []
            let reqFn = (g) => new Promise((res, rej) => {
                groupConn(g)
                    .then(r => res([g, r]))
                    .catch(e => rej([g, e]))
            })
            for (let g in floGlobals.groups)
                if (floGlobals.groups[g].status !== false)
                    promises.push(reqFn(g))
            Promise.allSettled(promises).then(result => {
                let ret = {};
                result.forEach(r => {
                    if (r.status === 'fulfilled')
                        ret[r.value[0]] = {
                            status: r.status,
                            value: r.value[1]
                        }
                    else if (r.status === "rejected")
                        ret[r.reason[0]] = {
                            status: r.status,
                            reason: r.reason[1]
                        }
                })
                resolve(ret)
            })
        })
    }
})();