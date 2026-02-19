import { ItemType } from '../../../types/Items'
import Item from './Item'
import Network from '../services/Network'
import store from '../stores'
import {
  openHostComputerDialog,
  openViewerComputerDialog,
  openViewerRequestDialog,
  showIncomingAccessRequest,
  showAccessDeniedMessage,
  closeViewerRequestDialog,
  setShareScreenManager
} from '../stores/ComputerStore'
import { phaserEvents, Event } from '../events/EventCenter'
import ShareScreenManager from '../web/ShareScreenManager'

export default class Computer extends Item {
  id?: string

  // Host of this computer (the one sharing screen)
  private hostId: string | null = null

  // All users currently interacting with this computer (host + viewers)
  private currentUsers = new Set<string>()

  // Whether the current local player has a pending request
  private hasPendingRequest = false

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    frame?: string | number
  ) {
    super(scene, x, y, texture, frame)
    this.itemType = ItemType.COMPUTER

    // Listen for server-forwarded events
    phaserEvents.on(Event.SCREEN_SHARE_REQUEST, this.onIncomingRequest, this)
    phaserEvents.on(Event.SCREEN_SHARE_APPROVED, this.onApproved, this)
    phaserEvents.on(Event.SCREEN_SHARE_DENIED, this.onDenied, this)
  }

  /* -----------------------------
     OVERLAP DIALOG (in-world)
  ------------------------------*/
  onOverlapDialog() {
    const game = this.scene as any
    const myId = game.network?.mySessionId

    if (!this.hostId) {
      this.setDialogBox('Press R to use computer')
      return
    }

    if (this.hostId === myId) {
      this.setDialogBox('Press R to manage computer')
      return
    }

    if (this.hasPendingRequest) {
      this.setDialogBox('Request sent. Waiting for approval...')
    } else {
      this.setDialogBox('Press R to request access')
    }
  }

  /* -----------------------------
     ADD/REMOVE USERS (from network)
  ------------------------------*/
  addCurrentUser(userId: string) {
    if (!this.currentUsers.has(userId)) {
      this.currentUsers.add(userId)
      // If this is the first user, they become the host
      if (!this.hostId) {
        this.hostId = userId
      }
    }
  }

  removeCurrentUser(userId: string) {
    if (this.currentUsers.delete(userId)) {
      // If the host left, clear host
      if (this.hostId === userId) {
        this.hostId = null
        
        // Cleanup share manager if we were viewing
        const computerState = store.getState().computer
        if (computerState.computerId === this.id && computerState.shareScreenManager) {
          computerState.shareScreenManager.onUserLeft(userId)
        }
      }
    }
  }

  /* -----------------------------
     INTERACT (press R)
  ------------------------------*/
  public interact(network: Network) {
    if (!this.id) return

    const myId = network.mySessionId

    // 1. No host -> I become the host
    if (!this.hostId) {
      this.hostId = myId
      this.currentUsers.add(myId)
      this.openDialogAsHost(myId, network)
      network.connectToComputer(this.id)
      return
    }

    // 2. I am the host -> Open host dialog
    if (this.hostId === myId) {
      this.openDialogAsHost(myId, network)
      network.connectToComputer(this.id)
      return
    }

    // 3. Someone else is host -> Show request options
    if (this.hostId) {
      store.dispatch(
        openViewerRequestDialog({
          computerId: this.id,
          hostId: this.hostId
        })
      )
    }
  }

  // Helper to ensure the Manager is initialized before opening the Host UI
  private openDialogAsHost(myId: string, network: Network) {
    if (!this.id) return
    const state = store.getState().computer
    let manager = state.shareScreenManager
    
    if (!manager) {
      manager = new ShareScreenManager(myId, network)
      store.dispatch(setShareScreenManager(manager))
    }
    manager.onOpen()

    store.dispatch(
      openHostComputerDialog({
        computerId: this.id,
        hostId: myId
      })
    )
  }

  /* -----------------------------
     VIEWER SENDS REQUEST
  ------------------------------*/
  public sendAccessRequest(network: Network, type: 'view' | 'control') {
    if (!this.id) return

    this.hasPendingRequest = true
    
    if (type === 'control') {
      network.room?.send("REMOTE_CONTROL_REQUEST", { computerId: this.id })
    } else {
      network.requestScreenShare(this.id, type)
    }
    
    this.onOverlapDialog() // update dialog text
  }

  /* -----------------------------
     HOST RESPONDS TO REQUEST
  ------------------------------*/
  public respondToRequest(
    network: Network,
    requesterId: string,
    approved: boolean,
    type: 'view' | 'control'
  ) {
    if (!this.id) return
    network.respondToScreenShareRequest(requesterId, this.id, approved, type)
  }

  /* -----------------------------
     INCOMING REQUEST (host sees)
  ------------------------------*/
  private onIncomingRequest = (
    requesterId: string,
    computerId: string,
    type: 'view' | 'control'
  ) => {
    if (computerId !== this.id) return

    const game = this.scene as any
    const myId = game.network?.mySessionId

    // Only the host sees the popup
    if (this.hostId !== myId) return

    const requesterName = store.getState().user.playerNameMap.get(requesterId) || 'User'
    store.dispatch(
      showIncomingAccessRequest({
        requesterId,
        requesterName,
        type
      })
    )
  }

  /* -----------------------------
     REQUEST APPROVED (viewer sees)
  ------------------------------*/
  private onApproved = (
    computerId: string,
    sharerId: string,
    type: 'view' | 'control'
  ) => {
    if (computerId !== this.id) return

    console.log(`[Computer] Request approved by ${sharerId} for ${type}`)
    this.hasPendingRequest = false
    store.dispatch(closeViewerRequestDialog()) // close the choice dialog if open

    const game = this.scene as any
    const myId = game.network?.mySessionId
    
    // Ensure manager exists for viewer too
    const state = store.getState().computer
    let manager = state.shareScreenManager
    if (!manager) {
      manager = new ShareScreenManager(myId, game.network)
      store.dispatch(setShareScreenManager(manager))
    }
    manager.onOpen()

    // Open viewer dialog specifically so the correct UI is loaded
    store.dispatch(
      openViewerComputerDialog({
        computerId: this.id,
        hostId: sharerId 
      })
    )
    
    game.network.connectToComputer(this.id)
  }

  /* -----------------------------
     REQUEST DENIED (viewer sees)
  ------------------------------*/
  private onDenied = (computerId: string) => {
    if (computerId !== this.id) return

    this.hasPendingRequest = false
    store.dispatch(showAccessDeniedMessage())

    this.setDialogBox('Access Denied')
    setTimeout(() => {
      this.onOverlapDialog()
    }, 2000)
  }

  /* -----------------------------
     CLEANUP (optional, called from store)
  ------------------------------*/
  public onHostLeft() {
    this.hostId = null
  }
}