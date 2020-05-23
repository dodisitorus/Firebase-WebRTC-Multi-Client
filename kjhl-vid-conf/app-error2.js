mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

const configuration = {
  'iceServers': [
    { 'urls': 'stun:stun.stunprotocol.org:3478' },
    { 'urls': 'stun:stun.l.google.com:19302' },
  ]
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;
let localUuid = null;
let localDisplayName = "null";
var peerConnections = {}; // key is uuid, values are peer connection object and user defined display name string
var roomRef = null;


function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

async function openUserMedia(e) {
  localUuid = createUUID();
  console.log(localUuid);

  var constraints = {
    video: {
      width: {max: 320},
      height: {max: 240},
      frameRate: {max: 30},
    },
    audio: false,
  };

  const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
  document.querySelector('#localVideo').srcObject = stream;
  localStream = stream;

  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
}

async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  const db = firebase.firestore();
  roomRef = await db.collection('rooms').doc();

  roomRef.collection('peers').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      // console.log("oke ini offer");
      selectionCollectionPeerConnections(change);
    });
  });
  
  const roomWithoutOffer = {
    uuid: localUuid,
    dest: "all",
    displayName: localDisplayName
  };

  await roomRef.set(roomWithoutOffer);

  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector('#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;
}

async function selectionCollectionPeerConnections(change) {
  if (change.type === 'added') {
    let data = change.doc.data();
    
    if (data.uuid == localUuid || (data.dest != localUuid && data.dest != 'all')) {
      return;
    }

    if (data.dest == 'all') {
      console.log("================= 1");
      
      setUpPeer(data.uuid, data.displayName);

      const roomWithOffer = {
        uuid: localUuid,
        dest: data.uuid,
        displayName: localDisplayName
      };
      
      await roomRef.collection('peers').add(roomWithOffer);

    } else if (data.dest == localUuid) {
      console.log("================= 2");

      setUpPeer(data.uuid, true);

    } else if (data.sdp) {
      console.log("================= 3");

      var dataAnswer = {
        type: data.type,
        sdp: data.sdp,
      }

      console.log(peerConnections[data.uuid]);
      peerConnections[data.uuid].setRemoteDescription(new RTCSessionDescription(dataAnswer)).then(function () {
        if (data.type == 'offer') {
          peerConnections[data.uuid].createAnswer().then(description => createdDescription(description, data.uuid)).catch(errorHandler);
        }
      }).catch(function(error) {
        errorHandler(error);
      });
    } else if (data.ice) {
      console.log("================= 4");

      peerConnections[data.uuid].addIceCandidate(new RTCIceCandidate(data.ice)).catch(errorHandler);
    }
  }
}

async function setUpPeer(peerUuid, initCall = false) {
  peerConnections[peerUuid] = new RTCPeerConnection(configuration);
  peerConnections[peerUuid].onicecandidate = event => gotIceCandidate(event, peerUuid);
  peerConnections[peerUuid].ontrack = event => gotRemoteStream(event, peerUuid);
  peerConnections[peerUuid].oniceconnectionstatechange = event => checkPeerDisconnect(event, peerUuid);
  peerConnections[peerUuid].addStream(localStream);
  
  if (initCall) {
    peerConnections[peerUuid].createOffer().then(description => createdDescription(description, peerUuid)).catch(errorHandler);
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

function gotRemoteStream(event, peerUuid) {
  // console.log("gotRemoteStream");

  var vidElement = document.createElement('video');
  vidElement.setAttribute('autoplay', '');
  vidElement.setAttribute('muted', '');
  vidElement.srcObject = event.streams[0];

  var vidContainer = document.createElement('div');
  vidContainer.setAttribute('id', 'remoteVideo_' + peerUuid);
  vidContainer.setAttribute('class', 'videoContainer');
  vidContainer.appendChild(vidElement);

  document.getElementById('videos').appendChild(vidContainer);

  updateLayout();

  console.log("================= 5");
  console.log(peerConnections)
}

function checkPeerDisconnect(event, peerUuid) {
  // console.log("checkPeerDisconnect");
  var state = peerConnections[peerUuid].iceConnectionState;
  if (state === "failed" || state === "closed" || state === "disconnected") {
    delete peerConnections[peerUuid];
    document.getElementById('videos').removeChild(document.getElementById('remoteVideo_' + peerUuid));
    updateLayout();
  }
}

async function createdDescription(description, peerUuid) {
  // console.log("createdDescription");
  peerConnections[peerUuid].setLocalDescription(description).then(async function () {
    const roomWithOffer = {
      type: description.type,
      sdp: description.sdp,
      uuid: localUuid,
      dest: peerUuid
    };
    await roomRef.collection('peers').add(roomWithOffer);
  }).catch(errorHandler);
}

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').
      addEventListener('click', async () => {
        roomId = document.querySelector('#room-id').value;
        console.log('Join room: ', roomId);
        document.querySelector('#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;
        await joinRoomById(roomId);
      }, {once: true});
  roomDialog.open();
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();

  if (roomSnapshot.exists) {

    roomRef.collection('peers').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        let data = change.doc.data();
        // console.log("oke ini answer");
        selectionCollectionPeerConnections(change);
      });
    });

    const roomWithAnswer = {
      uuid: localUuid,
      dest: "all"
    };
    
    await roomRef.collection('peers').add(roomWithAnswer);
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
  peerConnections[peerUuid].addEventListener('icegatheringstatechange', () => {
    // console.log(`ICE gathering state changed: ${peerConnections[peerUuid].iceGatheringState}`, peerUuid);
  });

  peerConnections[peerUuid].addEventListener('connectionstatechange', () => {
    // console.log(`Connection state change: ${peerConnections[peerUuid].connectionState}`, peerUuid);
  });

  peerConnections[peerUuid].addEventListener('signalingstatechange', () => {
    // console.log(`Signaling state change: ${peerConnections[peerUuid].signalingState}`, peerUuid);
  });

  peerConnections[peerUuid].addEventListener('iceconnectionstatechange ', () => {
    // console.log(`ICE connection state change: ${peerConnections[peerUuid].iceConnectionState}`, peerUuid);
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