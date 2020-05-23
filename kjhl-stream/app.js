mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

const configuration = {
  'iceServers': [
    { 'urls': 'stun:stun.stunprotocol.org:3478' },
    { 'urls': 'stun:stun.l.google.com:19302' },
  ]
};

let peerConnection = null;
let mainStream = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;
let localUuid = null;
let localDisplayName = "nulla";
var peerConnections = {}; // key is uuid, values are peer connection object and user defined display name string
var roomRef = null;


function init() {
  localUuid = createUUID();
  console.log(localUuid);

  document.querySelector('#startBtn').addEventListener('click', startBtn);
  document.querySelector('#createBtn').addEventListener('click', createStream);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  document.querySelector('#screenSharing').addEventListener('click', screenSharing);
  document.querySelector('#cameraStream').addEventListener('click', cameraStream);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

async function startBtn(e) {

  document.querySelector('#startBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
}

function createStream() {
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#screenSharing').disabled = false;
  document.querySelector('#cameraStream').disabled = false;
}

async function screenSharing(e) {
  var constraints = {
    video: {
      width: {max: 320},
      height: {max: 240},
      frameRate: {max: 30},
    },
    audio: false,
  };

  const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
  document.querySelector('#mainVideo').srcObject = stream;
  mainStream = stream;

  startStream();
}

async function cameraStream(e) {
  var constraints = {
    video: {
      width: {max: 320},
      height: {max: 240},
      frameRate: {max: 30},
    },
    audio: false,
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  document.querySelector('#mainVideo').srcObject = stream;
  mainStream = stream;

  startStream();
}

async function startStream() {
  document.querySelector('#screenSharing').disabled = true;
  document.querySelector('#cameraStream').disabled = true;

  const db = firebase.firestore();
  roomRef = await db.collection('streams').doc();

  roomRef.collection('peers').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      let data = change.doc.data();
      let peerUuid = data.uuid;
      console.log("offer --------");
      console.log(new Date().getMinutes() + " : " + new Date().getMilliseconds());
      
      if (change.type != 'added' || data.uuid == localUuid || (data.dest != localUuid && data.dest != 'all')) {
        console.log("================= 0");
        console.log(new Date().getMinutes() + " : " + new Date().getMilliseconds());

        return;
      }

      console.log(data);

      if (data.displayName && data.dest == 'all') {
        console.log("================= 1");
        console.log(new Date().getMinutes() + " : " + new Date().getMilliseconds());
        
        setUpPeer(peerUuid, data.displayName, false, true);
    
        await roomRef.collection('peers').add({
          uuid: localUuid,
          dest: peerUuid,
          displayName: localDisplayName
        });
      }

      if (data.sdp) {
        console.log("================= 3");
        console.log(new Date().getMinutes() + " : " + new Date().getMilliseconds());
    
        peerConnections[peerUuid].pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function () {
          if (data.sdp.type == 'offer') {
            peerConnections[peerUuid].pc.createAnswer().then(description => createdDescription(description, peerUuid)).catch(errorHandler);
          }
        }).catch(errorHandler);
      }
    });
  });
  
  const peerWithoutOffer = {
    uuid: localUuid,
    dest: "all",
    displayName: localDisplayName,
    owener: true
  };

  await roomRef.set(peerWithoutOffer);

  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector('#currentRoom').innerText = `Room ID : ${roomRef.id}`;
}

function joinRoom() {
  document.querySelector('#confirmJoinBtn').
      addEventListener('click', async () => {
        roomId = document.querySelector('#room-id').value;
        console.log('Join room: ', roomId);
        document.querySelector('#currentRoom').innerText = `Room ID : ${roomId}`;
        await joinRoomById(roomId);
      }, {once: true});
  roomDialog.open();
}

async function joinRoomById(roomId) {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#screenSharing').disabled = true;
  document.querySelector('#cameraStream').disabled = true;

  mainStream = new MediaStream();
  document.querySelector('#mainVideo').srcObject = mainStream;

  const db = firebase.firestore();
  roomRef = db.collection('streams').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();

  if (roomSnapshot.exists) {

    roomRef.collection('peers').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        let data = change.doc.data();
        let peerUuid = data.uuid;
        console.log("answer --------");
        console.log(new Date().getMinutes() + " : " + new Date().getMilliseconds());

        if (change.type != 'added' || data.uuid == localUuid || (data.dest != localUuid && data.dest != 'all')) {
          console.log("================= 0");
          console.log(new Date().getMinutes() + " : " + new Date().getMilliseconds());

          return;
        }
        
        console.log(data);

        if (data.displayName && data.dest == localUuid) {
          setUpPeer(peerUuid, data.displayName, true, false);
        }
      });
    });

    const peerWithoutOffer = {
      uuid: localUuid,
      dest: "all",
      displayName: localDisplayName,
      owener: false
    };
    
    await roomRef.collection('peers').add(peerWithoutOffer);
    await roomRef.set(peerWithoutOffer);
  }
}

async function setUpPeer(peerUuid, displayName, initCall = false, owener) {
  peerConnections[peerUuid] = {'displayName': displayName, 'pc': new RTCPeerConnection(configuration)};
  peerConnections[peerUuid].pc.onicecandidate = event => gotIceCandidate(event, peerUuid);
  peerConnections[peerUuid].pc.ontrack = event => gotRemoteStream(event, peerUuid, owener);
  peerConnections[peerUuid].pc.oniceconnectionstatechange = event => checkPeerDisconnect(event, peerUuid);
  peerConnections[peerUuid].pc.addStream(mainStream);
  
  if (initCall) {
    peerConnections[peerUuid].pc.createOffer().then(description => createdDescription(description, peerUuid)).catch(errorHandler);
  }

  registerPeerConnectionListeners(peerUuid)
}

async function gotIceCandidate(event, peerUuid) {
  // console.log("gotIceCandidate");
  if (event.candidate != null) {
    const roomWithCandidate = {
      ice: event.candidate.toJSON(),
      uuid: localUuid,
      dest: peerUuid
    };
    await roomRef.collection('peers').add(roomWithCandidate);
  }
}

function gotRemoteStream(event, peerUuid, owener) {
  // console.log("gotRemoteStream");
  event.streams[0].getTracks().forEach(track => {
    mainStream.addTrack(track);
  });
}

function createdDescription(description, peerUuid) {
  // console.log("createdDescription");
  peerConnections[peerUuid].pc.setLocalDescription(description).then(function () {
    const roomWithDescription = {
      sdp: peerConnections[peerUuid].pc.localDescription.toJSON(),
      uuid: localUuid,
      dest: peerUuid
    };
    roomRef.collection('peers').add(roomWithDescription);
  }).catch(errorHandler);
}

function checkPeerDisconnect(event, peerUuid) {
  // console.log("checkPeerDisconnect");
  var state = peerConnections[peerUuid].pc.iceConnectionState;
  if (state === "failed" || state === "closed" || state === "disconnected") {
    // delete peerConnections[peerUuid];
  }
}

async function hangUp(e) {

}

function registerPeerConnectionListeners(peerUuid) {
  if (peerConnections[peerUuid] != null) {
    peerConnections[peerUuid].pc.addEventListener('icegatheringstatechange', () => {
      // console.log(`ICE gathering state changed: ${peerConnections[peerUuid].pc.iceGatheringState}`, peerUuid);
    });
  
    peerConnections[peerUuid].pc.addEventListener('connectionstatechange', () => {
      // console.log(`Connection state change: ${peerConnections[peerUuid].pc.connectionState}`, peerUuid);
    });
  
    peerConnections[peerUuid].pc.addEventListener('signalingstatechange', () => {
      // console.log(`Signaling state change: ${peerConnections[peerUuid].pc.signalingState}`, peerUuid);
    });
  
    peerConnections[peerUuid].pc.addEventListener('iceconnectionstatechange ', () => {
      // console.log(`ICE connection state change: ${peerConnections[peerUuid].pc.iceConnectionState}`, peerUuid);
    });
  }
}

function createUUID() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  }

  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

function makeLabel(label) {
  var vidLabel = document.createElement('div');
  vidLabel.appendChild(document.createTextNode(label));
  vidLabel.setAttribute('class', 'videoLabel');
  return vidLabel;
}

function errorHandler(error) {
  console.log(error)
}


init();