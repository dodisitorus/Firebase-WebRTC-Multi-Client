mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

const configuration = {
  'iceServers': [
    { 'urls': 'stun:stun.stunprotocol.org:3478' },
    { 'urls': 'stun:stun.l.google.com:19302' },
  ]
};

var baseUrl = 'https://kjhl-vid-conf.web.app/'

var constraints = {
  video: true,
  audio: false,
};

let peerConnection = null;
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

  document.querySelector('#startBtn').addEventListener('click', startApp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  document.querySelector('#screenSharing').addEventListener('click', screenSharing);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));

  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);
  const id = urlParams.get('id');
  if (id != null) {
    document.querySelector('#startBtn').disabled = true;
    document.querySelector('#createBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = true;
    document.querySelector('#screenSharing').disabled = false;
    joinRoomById(id);
  }
}

function startApp() {
  document.querySelector('#startBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
}

async function openUserMedia(e) {

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;

  document.querySelector('#startBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
  document.querySelector('#screenSharing').disabled = false;
}

async function screenSharing(e) {
  localUuid = createUUID();

  const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;

  const db = firebase.firestore();
  roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();

  if (roomSnapshot.exists) {

    roomRef.collection('peers').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        selectionCollectionPeerConnections(change);
      });
    });

    const peerWithoutOffer = {
      uuid: localUuid,
      dest: "all",
      displayName: localDisplayName
    };
    
    await roomRef.collection('peers').add(peerWithoutOffer);
    await roomRef.set(peerWithoutOffer);
  }
}

async function createRoom() {

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;

  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#screenSharing').disabled = false;

  const db = firebase.firestore();
  roomRef = await db.collection('rooms').doc();

  roomRef.collection('peers').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      console.log();
      selectionCollectionPeerConnections(change);
    });
  });
  
  const peerWithoutOffer = {
    uuid: localUuid,
    dest: "all",
    displayName: localDisplayName
  };

  await roomRef.set(peerWithoutOffer);

  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector('#currentRoom').innerText = `URL : `+ baseUrl +`?id=${roomRef.id}`;
  document.querySelector('#urlString').value =  baseUrl + `?id=${roomRef.id}`; 
  document.querySelector('#urlCopy').style.display = "inline"; 
  document.querySelector('#urlCopy').disabled = false; 
  document.querySelector('#urlCopy').addEventListener('click', urlCopy);
}

function urlCopy() {
  var copyText = document.querySelector('#urlString');
  copyText.select();
  copyText.setSelectionRange(0, 99999);
  document.execCommand("copy");
}

async function selectionCollectionPeerConnections(change) {
  let data = change.doc.data();
  let peerUuid = data.uuid;

  if (change.type != 'added' || data.uuid == localUuid || (data.dest != localUuid && data.dest != 'all')) {
    console.log("================= 0");
    return;
  }

  if (data.displayName && data.dest == 'all') {
    console.log("================= 1");
    setUpPeer(peerUuid, data.displayName);
    
    await roomRef.collection('peers').add({
      uuid: localUuid,
      dest: peerUuid,
      displayName: localDisplayName
    });

    await roomRef.collection('peers').doc(change.doc.id).delete().then(function() {
      console.log("Document successfully deleted!");
    }).catch(function(error) {
        console.error("Error removing document: ", error);
    });
    
  } else if (data.displayName && data.dest == localUuid) {
    console.log("================= 2");
    setUpPeer(peerUuid, data.displayName, true);

  } else if (data.sdp) {
    console.log("================= 3");

    console.log(peerConnections);
    peerConnections[peerUuid].pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function () {
      if (data.sdp.type == 'offer') {
        peerConnections[peerUuid].pc.createAnswer().then(description => createdDescription(description, peerUuid)).catch(errorHandler);
      }
    }).catch(errorHandler);

  } else if (data.ice) {
    console.log("================= 4");

    peerConnections[peerUuid].pc.addIceCandidate(new RTCIceCandidate(data.ice)).catch(errorHandler);
  }
}

async function setUpPeer(peerUuid, displayName, initCall = false) {
  peerConnections[peerUuid] = {'displayName': displayName, 'pc': new RTCPeerConnection(configuration)};
  peerConnections[peerUuid].pc.onicecandidate = event => gotIceCandidate(event, peerUuid);
  peerConnections[peerUuid].pc.ontrack = event => gotRemoteStream(event, peerUuid);
  peerConnections[peerUuid].pc.oniceconnectionstatechange = event => checkPeerDisconnect(event, peerUuid);
  peerConnections[peerUuid].pc.addStream(localStream);
  
  if (initCall) {
    peerConnections[peerUuid].pc.createOffer().then(description => createdDescription(description, peerUuid)).catch(errorHandler);
  }

  registerPeerConnectionListeners(peerUuid)
}

function createdDescription(description, peerUuid) {
  // console.log("createdDescription");
  peerConnections[peerUuid].pc.setLocalDescription(description).then(function () {
    const roomWithDescription = {
      sdp: peerConnections[peerUuid].pc.localDescription.toJSON(),
      uuid: localUuid,
      dest: peerUuid
    };
    console.log(roomWithDescription.sdp.type);
    console.log(roomWithDescription)
    roomRef.collection('peers').add(roomWithDescription);
  }).catch(errorHandler);
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

function gotRemoteStream(event, peerUuid) {
  // console.log("gotRemoteStream");

  var vidElement = document.createElement('video');
  vidElement.setAttribute('autoplay', '');
  vidElement.setAttribute('muted', '');
  vidElement.setAttribute('class', 'col-lg-12 m-0 p-0');
  vidElement.srcObject = event.streams[0];

  var vidContainer = document.createElement('div');
  vidContainer.setAttribute('id', 'remoteVideo_' + peerUuid);
  vidContainer.setAttribute('class', 'videoContainer col-lg-3 m-0 p-0');
  vidContainer.appendChild(vidElement);

  document.getElementById('videos').appendChild(vidContainer);

  updateLayout();
}

function checkPeerDisconnect(event, peerUuid) {
  // console.log("checkPeerDisconnect");
  var state = peerConnections[peerUuid].pc.iceConnectionState;
  if (state === "failed" || state === "closed" || state === "disconnected") {
    delete peerConnections[peerUuid];
    document.getElementById('videos').removeChild(document.getElementById('remoteVideo_' + peerUuid));
    updateLayout();
  }
}

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#screenSharing').disabled = false;

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

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;

  const db = firebase.firestore();
  roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();

  if (roomSnapshot.exists) {

    roomRef.collection('peers').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        selectionCollectionPeerConnections(change);
      });
    });

    const peerWithoutOffer = {
      uuid: localUuid,
      dest: "all",
      displayName: localDisplayName
    };
    
    await roomRef.collection('peers').add(peerWithoutOffer);
    await roomRef.set(peerWithoutOffer);
  }
}

function updateLayout() {

  // update CSS grid based on number of diplayed videos
  var rowHeight = '98vh';
  var colWidth = '98vw';

  var numVideos = Object.keys(peerConnections).length + 1; // add one to include local video

  if (numVideos > 1 && numVideos <= 4) { // 2x2 grid
    rowHeight = '48vh';
    colWidth = '48vw';
  } else if (numVideos > 4) { // 3x3 grid
    rowHeight = '32vh';
    colWidth = '32vw';
  }

  document.documentElement.style.setProperty(`--rowHeight`, rowHeight);
  document.documentElement.style.setProperty(`--colWidth`, colWidth);
}

async function hangUp(e) {

}

function registerPeerConnectionListeners(peerUuid) {
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