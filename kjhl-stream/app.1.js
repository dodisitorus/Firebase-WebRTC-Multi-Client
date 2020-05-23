mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

let peerConnection = null;
let mainStream = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;
let member = 1;
var peerConnections = {}; // key is uuid, values are peer connection object and user defined display name string


function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

async function openUserMedia(e) {
  mainStream = new MediaStream();
  document.querySelector('#mainVideo').srcObject = mainStream;

  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
}

async function createRoom() {
  const stream = await navigator.mediaDevices.getDisplayMedia(
    {video: true, audio: true});
  document.querySelector('#mainVideo').srcObject = stream;
  mainStream = stream;

  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  const db = firebase.firestore();
  const roomRef = await db.collection('rooms').doc();

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);

  registerPeerConnectionListeners();

  mainStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, mainStream);
  });

  // Code for collecting ICE candidates below
  const callerCandidatesCollection = roomRef.collection('callerCandidates');

  peerConnection.addEventListener('icecandidate', event => {
    if (!event.candidate) {
      console.log('Got final candidate!');
      return;
    }
    console.log('Got candidate: ', event.candidate);
    callerCandidatesCollection.add(event.candidate.toJSON());
  });
  // Code for collecting ICE candidates above

  // Code for creating a room below
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const roomWithOffer = {
    'offer': {
      type: offer.type,
      sdp: offer.sdp,
    },
  };
  
  await roomRef.collection('offers').add(roomWithOffer);
  await roomRef.set(roomWithOffer);

  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector(
      '#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;
  // Code for creating a room above

  // Listening for remote session description below
  roomRef.collection('answers').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        if (!peerConnection.currentRemoteDescription && data && data.answer) {
          console.log("---------- answers ------------");
          console.log('Got remote description 2:', data.answer);
          const rtcSessionDescription = new RTCSessionDescription(data.answer);
          await peerConnection.setRemoteDescription(rtcSessionDescription);
        }
      }
    });
  });
  // Listening for remote session description above
}

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').
      addEventListener('click', async () => {
        roomId = document.querySelector('#room-id').value;
        console.log('Join room: ', roomId);
        document.querySelector(
            '#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;
        await joinRoomById(roomId);
      }, {once: true});
  roomDialog.open();
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);

  if (roomSnapshot.exists) {
    console.log('Create PeerConnection with configuration: ', configuration);
    peerConnection = new RTCPeerConnection(configuration);
    
    console.log("1. ===============");
    console.log(peerConnection)

    registerPeerConnectionListeners();

    // Code for collecting ICE candidates below
    const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
    peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log("8. ===============");
        console.log('Got final candidate!');
        return;
      }

      console.log("7. ===============");
      console.log('Got candidate: ', event.candidate);
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });
    // Code for collecting ICE candidates above

    peerConnection.addEventListener('track', event => {
      event.streams[0].getTracks().forEach(track => {
        console.log("6. ===============");
        mainStream.addTrack(track);
      });
    });

    // Code for creating SDP answer below
    roomRef.collection('offers').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        let data = change.doc.data();
        console.log("2. ===============");
        console.log("---------- offers change ------------");
        if (!peerConnection.currentRemoteDescription && data && data.offer) {
          console.log("3. ===============");
          console.log(data.offer);
          const rtcSessionDescription = new RTCSessionDescription(data.offer);
          await peerConnection.setRemoteDescription(rtcSessionDescription);

          const answer = await peerConnection.createAnswer();
          console.log("4. ===============");
          console.log('Created answer:', answer);
          await peerConnection.setLocalDescription(answer);
      
          const rAnswer = {
            "answer" : {
              type: answer.type,
              sdp: answer.sdp,
            },
          };
      
          await roomRef.collection('answers').add(rAnswer);
        }
      });
    });
    // Code for creating SDP answer above

    // Listening for remote ICE candidates below
    roomRef.collection('callerCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log("5. ===============");
          console.log(JSON.stringify(data));
          await peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
    // Listening for remote ICE candidates above
  }
}

async function hangUp(e) {
  const tracks = document.querySelector('#mainVideo').srcObject.getTracks();
  tracks.forEach(track => {
    track.stop();
  });

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector('#mainVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  // Delete room on hangup
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

function registerPeerConnectionListeners() {
  peerConnection.addEventListener('icegatheringstatechange', () => {
    console.log(
        `ICE gathering state changed: ${peerConnection.iceGatheringState}`);
  });

  peerConnection.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener('iceconnectionstatechange ', () => {
    console.log(
        `ICE connection state change: ${peerConnection.iceConnectionState}`);
  });
}

function createUUID() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  }

  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

init();