// bricker.js
// Browser-based clicker web application
// Mark F. Russo PhD
// The College of New Jersey

const os = require('os');
const fs = require('fs');
const xp = require('express');
const ws = require('ws');

// --- App constants
const app     = xp()
let   port    = 80
let   wssport = 8080;

// TODO: Format question and summary HTML to match admin page
// TODO: Update question, summary and client selects individually rather than reload entire page
// TODO: Make stopwatch a countdown clock
// TODO: Make countdown report control and start/stop
// TODO: Add a remote-controlled stopwatch to the question page
// TODO: Do something with verbose command line option

// --- Routes
// https://expressjs.com/en/guide/routing.html
//app.get('/test', (req, res) => res.send('/test'))
app.get('/',         page_question);
app.get('/template', page_question);    // Currently active question template
app.get('/qcontext', ctx_question);     // Currently active question context (data)
app.get('/summary',  page_summary);     // Summary page showing response summary (localhost only)
app.get('/scontext', ctx_summary);      // Answer summary context (data)
app.get('/admin',    page_admin);       // Admin page to see details and select question (localhost only)
app.get('/acontext', ctx_admin);        // Context for admin page (data)

// Serve static files from the static directory
app.use('/static', xp.static('static'))

// = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// --- Global objects and config

// Global context to substitute into all rendered pages
var question_context = {
    _question: 'What Is the airspeed velocity of an unladen swallow?',
    _options : {
        A: '10 m/hour',
        B: '100 m/hour',
        C: '1000 m/hour',
        D: 'Depends on whether it is African or European',
        E: 'None of the above'
    }
}

// Template to use to render question, found in questions subdirectory
var question_template = "questions/default.html";

// Global object to hold all responses. Updated dynamically.
var responses = {};

// Global object for summary historgram data
// Format: {'_question':<question>, "_total":<#>, "_port":<#>, "_wssport":<#>, <ans1>:<#>, <ans2>:<#>, ...}
var summary_context = {'_question':'', '_options':{'A':'', 'B':'', 'C':'', 'D':'', 'E':''}};
var summary_default = {'_question':'', '_options':{'A':'', 'B':'', 'C':'', 'D':'', 'E':''}};

// Global objects to track connection websockets for broadcasting messages
var question_clients = new Set();
var summary_clients  = new Set();
var admin_clients    = new Set();

// Create and configure global websocket server
var wss = new ws.Server({port: wssport});

//console.log('Remote: ' + req.connection.remoteAddress + ":" + req.connection.remotePort + " (" + req.connection.remoteFamily + ")");
//console.log('Local: ' + req.connection.localAddress + ":" + req.connection.localPort + " (" + req.connection.localFamily + ")");
// Handle a message received from a client websocket

// When a websocket client connects
wss.on('connection', function (ws, req) {
    let remoteAddress = req.connection.remoteAddress;
    let remotePort    = req.connection.remotePort;

    // All messages are expected to have the form {"cmd":<command>, "data":<data>}
    ws.on('message', function (message) {
        let remote = remoteAddress + ":" + remotePort
        console.log('received ' + message + ' from ' + remote);

        let msg = JSON.parse(message);

        // Add to responses object
        if (msg.cmd === "response") {
            responses[remote] = msg.data;
            updateSummary();    // Recompute summary
            broadcastToSummary({"cmd":"reload"});
        } else if (msg.cmd === "connected" && msg.data === "question") {
            question_clients.add(ws);
            broadcastToAdmin({"cmd":"reload"});
        } else if (msg.cmd === "connected" && msg.data === "summary") {
            summary_clients.add(ws);
            broadcastToAdmin({"cmd":"reload"});
        } else if (msg.cmd === "connected" && msg.data === "admin") {
            admin_clients.add(ws);
        } else if (msg.cmd === "set_context")  {   // Set the question data
            setContext(msg.data);
            broadcastToQuestion({"cmd":"reload"});
        } else if (msg.cmd === "set_template") {   // Set the question template 
            setTemplate(msg.data);
        }
    });

    // Remove from everywhere on disconnect
    ws.on('close', function (message) {
        console.log('disconnected');
        summary_clients.delete(ws);
        question_clients.delete(ws);
        admin_clients.delete(ws);
        broadcastToAdmin({"cmd":"reload"});
    });

    // setInterval(
    //     () => ws.send(`${new Date()}`),
    //     1000
    // );
});

// = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// --- Request handlers

// To capture querystring data
// If a question file is given, load it first
// if (req.query.q) {
//     let qfile = req.query.q;
//     setContext(qfile);
//     broadcastToQuestion({"msg":"reload"});
// }

// Return the current question template page
function page_question(req, res) {
    let page = fs.readFileSync(question_template, 'utf8');
    res.send(page);
}

// Return the current question context
function ctx_question(req, res) {
    let qclone = clone(question_context);
    if (qclone._file) {
        try {
            qclone._file = fs.readFileSync(qclone._file, 'utf8');
        } catch (ex) {
            console.log(`${qclone._file} not found`);
        }
    }
    qclone['_port']    = port;
    qclone['_wssport'] = wssport;
    if (qclone._file) { }
    res.json(qclone);
}

// Get results summary page
function page_summary(req, res) {
    if ( ['localhost', '127.0.0.1'].includes(req.hostname) ) {
        let page = fs.readFileSync('summary.html', 'utf8');
        res.send(page);
    } else {
        res.status(403).send('Forbidden');
    }
}

// Return the current summary context
function ctx_summary(req, res) {
    if ( ['localhost', '127.0.0.1'].includes(req.hostname) ) {
        let sclone = clone(summary_context);    // Clone object
        sclone['_port']    = port;
        sclone['_wssport'] = wssport;
        res.json(sclone);
    } else {
        res.status(403).send('Forbidden');
    }
}

// Get the administrator page
function page_admin(req, res) {
    if ( ['localhost', '127.0.0.1'].includes(req.hostname) ) {
        let page = fs.readFileSync('admin.html', 'utf8');
        res.send(page);
    } else {
        res.status(403).send('Forbidden');
    }
}

// Return the current admin context
function ctx_admin(req, res) {
    if ( ['localhost', '127.0.0.1'].includes(req.hostname) ) {
        // Get all files
        let questions = getFiles("./questions", /\.json$/);
        let templates = getFiles("./questions", /\.html$/);
        let serverIPs = getServerIPs();
        let summaries = getSummaryClients();
        let clients   = getQuestionClients();
        let actx     = {
            "questions": JSON.stringify(questions), 
            "templates": JSON.stringify(templates),
            "servers"  : JSON.stringify(serverIPs), 
            "question_clients" : JSON.stringify(clients),
            "summary_clients"  : JSON.stringify(summaries),
            "_port"    : port,
            "_wssport" : wssport
        };
        res.json(actx);
    } else {
        res.status(403).send('Forbidden');
    }
}

// = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// --- Utilities

// Utility to clone an object
function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Send a message to all connected clients
function broadcast(obj) {
    let msg = JSON.stringify(obj);
    wss.clients.forEach(function each(ws) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
        }
    });
}

// Broadcast message to question clients
function broadcastToQuestion(obj) {
    let msg = JSON.stringify(obj);
    question_clients.forEach(function each(ws) {
        if (ws.readyState === ws.OPEN) {  ws.send(msg); }
    });
}

// Broadcast message to summary clients
function broadcastToSummary(obj) {
    let msg = JSON.stringify(obj);
    summary_clients.forEach(function each(ws) {
        if (ws.readyState === ws.OPEN) {  ws.send(msg); }
    });
}

// Broadcast message to admin clients
function broadcastToAdmin(obj) {
    let msg = JSON.stringify(obj);
    admin_clients.forEach(function each(ws) {
        if (ws.readyState === ws.OPEN) {  ws.send(msg); }
    });
}

// Determine if an IPv4 address is private
// Reserved by the Internet Assigned Numbers Authority (IANA) 
// for use as private IPv4 addresses
// 10.0.0.0    to 10.255.255.255
// 172.16.0.0  to 172.31.255.255
// 192.168.0.0 to 192.168.255.255
function isPrivateIPv4(ip) {
    let iplong = IPv4toLong(ip);
    if (IPv4toLong('10.0.0.0'   ) <= iplong && iplong <= IPv4toLong('10.255.255.255' )) { return true; }
    if (IPv4toLong('172.16.0.0' ) <= iplong && iplong <= IPv4toLong('172.31.255.255' )) { return true; }
    if (IPv4toLong('192.168.0.0') <= iplong && iplong <= IPv4toLong('192.168.255.255')) { return true; }
    return false;
}

// Convert a dotted IPv4 address to a long
function IPv4toLong(ip) {
    let parts = ip.split(".");
    let arr1 = new Uint8Array(4);
    for (let i=0; i<4; i++) { arr1[i] = parseInt(parts[3-i]); }
    let arr2 = new Uint32Array( arr1.buffer );
    return arr2[0];
}

// Get a list of data for all current question clients
function getQuestionClients() {
    let clients = [];
    question_clients.forEach(function each(ws) {
        clients.push( {"address": ws._socket.remoteAddress, "port":ws._socket.remotePort, "state":ws.readyState} );
    });
    return clients;
}

// Get a list of data for all summary clients
function getSummaryClients() {
    let clients = [];
    summary_clients.forEach(function each(ws) {
        clients.push( {"address": ws._socket.remoteAddress, "port":ws._socket.remotePort, "state":ws.readyState} );
    });
    return clients;
}

// Get the host server IPv4 addresses
function getServerIPs() {
    var ifaces = os.networkInterfaces();

    var IPs = [];
    Object.keys(ifaces).forEach(function (ifname) {
        var alias = 0;

        ifaces[ifname].forEach(function (iface) {
            if (iface.family !== 'IPv4' || iface.internal !== false) {
                // skip over internal (i.e. 127.0.0.1) and non-IPv4 addresses
                return;
            }
            if (alias >= 1) {
                // this single interface has multiple IPv4 addresses
                IPs.unshift([ifname + ':' + alias, iface.address]);
            } else {
                // this interface has only one IPv4 address
                IPs.unshift([ifname, iface.address]);
            }
            ++alias;
        });
    });

    return IPs;
}

// Load context from a question file and reset other globals
function setContext(qctxfile) {
    question_context  = JSON.parse(fs.readFileSync(qctxfile, 'utf8'));
    summary_context = clone(summary_default);
    responses = {};
}

// Set the question template file to use
function setTemplate(template) {
    question_template = template;
}


// Take a String and an object and replace all occurrences of all keys in object 
// with values, where keys use the standard js template notation of ${key}.
// If value is an object stringify and substitute string
// function render(templ, subst) {
//     for (let key in subst) {
//         if ((typeof subst[key]) === 'object') { subst[key] = JSON.stringify(subst[key]); }
//         let re = new RegExp('\\${'+key+'}', 'g');
//         templ = templ.replace(re, subst[key]);
//     }
//     return templ;
// }

// Takes an optional files containing a JSON object to be used for substitution into page
// function renderPage(htmlfile, subst={}) {
//     let page = fs.readFileSync(htmlfile, 'utf8');
//     return render(page, subst);
// }

// Take the responses object and compute a historgram used to make a bar chart
// Object keys are responders and values are responses
function updateSummary() {
    // Copy answer option keys from question to ctx
    let ctx = clone(summary_default);
    ctx._question = question_context._question;
    ctx._options  = {};
    for (let opt in question_context._options) { ctx._options[opt] = 0; }

    // Count each resp
    let total = 0;
    for (let client in responses) {
        let ans = responses[client];
        if (ans in ctx._options) {
            ctx._options[ans]++;
            total++;
        }
    }
    ctx._total = total;
    summary_context = ctx;
}

// Process command line arguments into an args object.
// Take an object with allowed option single-dash shorthands
function commandLineArgs(shands = {}) {
    let args   = {};
    let option = null;
    process.argv.forEach( (el, index) => {
        // Look for an option flag
        let mlong = el.match(/^--(\S+)$/);
        let mabbr = el.match(/^-(\S+)$/);

        // If we have an option, init the args object with value null
        if (mlong) {
            option = mlong[1];
            args[option] = null;
        
        // Abbreviated option (one dash) and in abbrev object
        } else if (mabbr && shands.hasOwnProperty(mabbr[1])) {
            option = shands[mabbr[1]];
            args[option] = null;
        
        // If no match but option was found last time around
        // Update option value to el and clear option
        } else if (option) {
            args[option] = el;
            option = null;
        }
    });
    return args;
}

// Get a list of files
// path    : path to directory containing files
// pattern : regex like /.*/ for all files, /\.html$/ for files with html extension
// Examples
// Get all files with .json extension in html subdirectory: getFiles("./html", /\.json$/) 
function getFiles(path, pattern) {
    var files = fs.readdirSync(path, {"encoding":"utf-8"});
    let matching = [];
    for (let f of files) {
        if (f.match(pattern)) { 
            matching.push(f); 
        }
    }
    return matching;
}

// = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
// Startup

// Handle command line arguments with abbreviations
let args = commandLineArgs( {p:'port', wp: 'wssport', 'v':'verbose'} );
if (args['port'])    { port    = parseInt( args['port'] ); }
if (args['wssport']) { wssport = parseInt( args['wssport'] ); }

// On startup, populate summary with initial values
updateSummary();

// Print this server's IPv4 addresses
console.log("Please visit:");
getServerIPs().forEach( function( pair ) {
    let ip = pair[1];
    console.log( `    http://${ip}${port !== 80? ":"+port: ''} (${isPrivateIPv4(ip)? 'private':'public'})` );
});

// Start HTTP server
app.listen(port, () => console.log("Server started"));
