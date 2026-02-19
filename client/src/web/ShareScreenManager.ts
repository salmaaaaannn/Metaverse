import Peer from 'peerjs'
import store from '../stores'
import {
  setMyStream,
  addVideoStream,
  removeVideoStream
} from '../stores/ComputerStore'
import phaserGame from '../PhaserGame'
import Game from '../scenes/Game'
import Network from '../services/Network'

export default class ShareScreenManager {
  private peer: Peer
  private myStream?: MediaStream
  private dataConnections = new Map<string, Peer.DataConnection>()
  
  // FIX: Store computerId locally to avoid calling store.getState() during cleanup
  private sharingComputerId: string | null = null 

  // NEW: WebSocket to communicate with the local Windows Companion App
  private localCompanionSocket: WebSocket | null = null

  constructor(
    private userId: string,
    public network: Network
  ) {
    const peerId = this.makePeerId(userId)
    this.peer = new Peer(peerId)
    this.setupPeerListeners()
  }

  /* ============================================================
     COMPANION APP BRIDGE (Localhost to OS)
  ============================================================ */

  private connectToCompanion() {
    try {
      this.localCompanionSocket = new WebSocket('ws://localhost:8080')
      
      this.localCompanionSocket.onopen = () => {
        console.log('[ShareScreenManager] Connected to Local Companion App. Remote control ENABLED.')
      }
      
      this.localCompanionSocket.onerror = (err) => {
        console.warn('[ShareScreenManager] Companion App not detected. Screen share will work, but remote control will be view-only.')
      }
    } catch (e) {
      console.warn('[ShareScreenManager] Failed to create WebSocket to Companion App.')
    }
  }

  // Helper to process incoming data from viewers and send to OS
  private handleRemoteInput(data: any) {
    if (this.localCompanionSocket && this.localCompanionSocket.readyState === WebSocket.OPEN) {
      this.localCompanionSocket.send(JSON.stringify(data))
    } else {
      // Fallback: Dispatch to Phaser just in case you want in-game UI reactions
      const game = phaserGame.scene.keys.game as Game
      game?.events.emit('remote_input', data)
    }
  }

  /* ============================================================
     PEER SETUP
  ============================================================ */

  private setupPeerListeners() {
    this.peer.on('open', (id) => {
      console.log('[ShareScreenManager] Peer connected:', id)
    })

    this.peer.on('error', (err) => {
      console.error('[ShareScreenManager] Peer error:', err)
    })

    this.peer.on('call', (call) => {
      call.answer()
      call.on('stream', (remoteStream) => {
        store.dispatch(addVideoStream({ id: call.peer, call, stream: remoteStream }))
      })
      call.on('close', () => {
        store.dispatch(removeVideoStream(call.peer))
      })
    })

    // This handles data connections IF the viewer initiates them
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        console.log('[ShareScreenManager] Data connection open:', conn.peer)
        this.dataConnections.set(conn.peer, conn)
      })
      
      conn.on('data', (data: any) => {
        // Forward input to the real computer
        this.handleRemoteInput(data)
      })
      
      conn.on('close', () => {
        this.dataConnections.delete(conn.peer)
      })
    })
  }

  /* ============================================================
     DIALOG LIFECYCLE
  ============================================================ */

  onOpen() {
    if (this.peer.disconnected) {
      this.peer.reconnect()
    }
  }

  onClose() {
    this.stopScreenShare()
    this.peer.disconnect()
  }

  /* ============================================================
     HOST CONTROLS
  ============================================================ */

  async startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })

      const track = stream.getVideoTracks()[0]
      if (track) {
        track.onended = () => this.stopScreenShare()
      }

      this.myStream = stream
      
      // NEW: Attempt to connect to the local companion app when sharing starts
      this.connectToCompanion()
      
      const state = store.getState().computer
      this.sharingComputerId = state.computerId

      store.dispatch(setMyStream(stream))

      const game = phaserGame.scene.keys.game as Game
      
      if (this.sharingComputerId) {
        console.log('[ShareScreenManager] Sharing started:', this.sharingComputerId)
        game.network.startScreenShare(this.sharingComputerId)
      }
    } catch (err) {
      console.error('[ShareScreenManager] Screen share failed:', err)
    }
  }

  stopScreenShare() {
    if (this.myStream) {
      this.myStream.getTracks().forEach((t) => t.stop())
      this.myStream = undefined
    }

    // NEW: Close the bridge to the OS when sharing stops
    if (this.localCompanionSocket) {
      this.localCompanionSocket.close()
      this.localCompanionSocket = null
    }

    this.dataConnections.forEach((conn) => conn.close())
    this.dataConnections.clear()

    store.dispatch(setMyStream(null))

    if (this.sharingComputerId) {
      const game = phaserGame.scene.keys.game as Game
      console.log('[ShareScreenManager] Sharing stopped:', this.sharingComputerId)
      game.network.stopScreenShare(this.sharingComputerId)
      
      this.sharingComputerId = null 
    }
  }

  /* ============================================================
     HOST APPROVES VIEWER
  ============================================================ */

  onUserApproved(viewerId: string, type: 'view' | 'control') {
    if (!this.myStream) return
    const viewerPeerId = this.makePeerId(viewerId)
    console.log(`[ShareScreenManager] Approving ${viewerId} (${type})`)

    const call = this.peer.call(viewerPeerId, this.myStream)
    call.on('close', () => {
      store.dispatch(removeVideoStream(viewerPeerId))
    })

    if (type === 'control') {
      // Host initiates data channel to viewer for input
      const conn = this.peer.connect(viewerPeerId)
      
      conn.on('open', () => {
        console.log('[ShareScreenManager] Control channel open:', viewerId)
        this.dataConnections.set(viewerPeerId, conn)
      })
      
      // NEW: The Host MUST listen to data on the connection they initiated
      conn.on('data', (data: any) => {
        this.handleRemoteInput(data)
      })
      
      conn.on('close', () => {
        this.dataConnections.delete(viewerPeerId)
      })
    }
  }

  /* ============================================================
     VIEWER SIDE
  ============================================================ */

  connectToSharer(sharerId: string) {
    console.log('[ShareScreenManager] Viewer waiting for host call:', sharerId)
  }

  /* ============================================================
     REMOTE CONTROL (Viewer sends input)
  ============================================================ */

  sendInput(inputData: any) {
    this.dataConnections.forEach((conn) => {
      if (conn.open) {
        conn.send(inputData)
      }
    })
  }

  /* ============================================================
     USER LEFT CLEANUP
  ============================================================ */

  onUserLeft(userId: string) {
    const peerId = this.makePeerId(userId)
    store.dispatch(removeVideoStream(peerId))
    const conn = this.dataConnections.get(peerId)
    if (conn) {
      conn.close()
      this.dataConnections.delete(peerId)
    }
  }

  /* ============================================================
     UTIL
  ============================================================ */

  private makePeerId(id: string) {
    return id.replace(/[^0-9a-z]/gi, 'G') + '-ss'
  }
}