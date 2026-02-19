import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import ScreenShareIcon from '@mui/icons-material/ScreenShare'
import SettingsRemoteIcon from '@mui/icons-material/SettingsRemote'

import { useAppSelector, useAppDispatch } from '../hooks'
import {
  closeComputerDialog,
  clearIncomingAccessRequest,
  clearAccessDeniedMessage
} from '../stores/ComputerStore'

import Video from './Video'

/* ============================================================ */
/* STYLES */
/* ============================================================ */

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  padding: 16px 180px 16px 16px;
`

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  background: #222639;
  border-radius: 16px;
  padding: 16px;
  color: #eee;
  position: relative;
  display: flex;
  flex-direction: column;
`

const VideoGrid = styled.div`
  flex: 1;
  display: grid;
  grid-gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(40%, 1fr));
`

const OrangePopup = styled.div`
  position: absolute;
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
  background: #2a2a3a;
  border: 2px solid #ff9800;
  padding: 20px;
  border-radius: 12px;
  z-index: 1000;
`

const StatusMessage = styled.div`
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #444;
  padding: 8px 16px;
  border-radius: 20px;
`

/* ============================================================ */
/* INTERACTIVE VIDEO WRAPPER (For Remote Control) */
/* ============================================================ */

function InteractiveVideo({ stream, manager, canControl }: { stream: MediaStream, manager: any, canControl: boolean }) {
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canControl || !manager) return
    const rect = e.currentTarget.getBoundingClientRect()
    
    // Normalize coordinates to 0.0 - 1.0 to work across different screen sizes
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    
    manager.sendInput({ type: 'mousemove', x, y })
  }

  const handleClick = () => {
    if (!canControl || !manager) return
    manager.sendInput({ type: 'click' })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canControl || !manager) return
    manager.sendInput({ type: 'keypress', key: e.key })
  }

  return (
    <div
      tabIndex={0}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        background: 'black',
        borderRadius: '8px',
        overflow: 'hidden',
        outline: 'none',
        cursor: canControl ? 'crosshair' : 'default',
        width: '100%',
        minHeight: '300px'
      }}
    >
      <Video 
        srcObject={stream} 
        autoPlay 
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} 
      />
    </div>
  )
}


/* ============================================================ */
/* COMPONENT */
/* ============================================================ */

export default function ComputerDialog() {
  const dispatch = useAppDispatch()

  const mode = useAppSelector((s) => s.computer.mode)
  const computerId = useAppSelector((s) => s.computer.computerId)
  const myStream = useAppSelector((s) => s.computer.myStream)
  const peerStreams = useAppSelector((s) => s.computer.peerStreams)
  const incomingRequest = useAppSelector((s) => s.computer.incomingRequest)
  const accessDenied = useAppSelector((s) => s.computer.accessDenied)
  const shareScreenManager = useAppSelector((s) => s.computer.shareScreenManager)
  const playerNameMap = useAppSelector((s) => s.user.playerNameMap)

  const [statusMsg, setStatusMsg] = useState('')

  /* ============================================================ */
  /* ACCESS DENIED */
  /* ============================================================ */

  useEffect(() => {
    if (accessDenied) {
      setStatusMsg('Access Denied.')
      setTimeout(() => {
        setStatusMsg('')
        dispatch(clearAccessDeniedMessage())
      }, 3000)
    }
  }, [accessDenied, dispatch])

  /* ============================================================ */
  /* HOST ACTIONS */
  /* ============================================================ */

  const toggleShare = () => {
    if (!shareScreenManager) return

    if (myStream) {
      shareScreenManager.stopScreenShare()
    } else {
      shareScreenManager.startScreenShare()
    }
  }

  const approveRequest = async () => {
    if (!incomingRequest.open || !shareScreenManager || !computerId) return

    // FIX 1: If the Host hasn't started their screen share yet, force it to start!
    if (!myStream) {
      await shareScreenManager.startScreenShare()
    }

    shareScreenManager.network.respondToScreenShareRequest(
      incomingRequest.requesterId!,
      computerId,
      true,
      incomingRequest.type!
    )

    shareScreenManager.onUserApproved(
      incomingRequest.requesterId!,
      incomingRequest.type!
    )

    dispatch(clearIncomingAccessRequest())
  }

  const denyRequest = () => {
    if (!incomingRequest.open || !shareScreenManager || !computerId) return

    shareScreenManager.network.respondToScreenShareRequest(
      incomingRequest.requesterId!,
      computerId,
      false,
      incomingRequest.type!
    )

    dispatch(clearIncomingAccessRequest())
  }

  /* ============================================================ */
  /* VIEWER ACTIONS */
  /* ============================================================ */

  const requestAccess = (type: 'view' | 'control') => {
    if (!shareScreenManager || !computerId) return

    setStatusMsg(`Requesting ${type} access...`)

    // FIX 2: Explicitly send the correct network message so the type isn't dropped
    if (type === 'control') {
      shareScreenManager.network.room?.send("REMOTE_CONTROL_REQUEST", { computerId })
    } else {
      shareScreenManager.network.requestScreenShare(computerId)
    }
  }

  /* ============================================================ */
  /* RENDER */
  /* ============================================================ */

  return (
    <Backdrop>
      <Wrapper>

        <IconButton
          onClick={() => {
            console.log('Close button clicked');
            dispatch(closeComputerDialog());
          }}
          style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}
        >
          <CloseIcon />
        </IconButton>

        {/* HOST POPUP */}
        {mode === 'host' && incomingRequest.open && (
          <OrangePopup>
            <h3>
              {incomingRequest.type === 'control'
                ? 'Remote Control Request'
                : 'Screen View Request'}
            </h3>

            <p>
              <strong>
                {playerNameMap.get(incomingRequest.requesterId!) || 'User'}
              </strong>{' '}
              wants to{' '}
              {incomingRequest.type === 'control'
                ? 'CONTROL your computer.'
                : 'view your screen.'}
            </p>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button
                variant="contained"
                color="success"
                onClick={approveRequest}
              >
                Allow
              </Button>

              <Button
                variant="contained"
                color="error"
                onClick={denyRequest}
              >
                Deny
              </Button>
            </div>
          </OrangePopup>
        )}

        {statusMsg && <StatusMessage>{statusMsg}</StatusMessage>}

        <div style={{ marginBottom: 12, display: 'flex', gap: 10, zIndex: 1 }}>

          {mode === 'host' && (
            <Button
              variant="contained"
              color={myStream ? 'error' : 'primary'}
              startIcon={<ScreenShareIcon />}
              onClick={toggleShare}
            >
              {myStream ? 'Stop Sharing' : 'Share Screen'}
            </Button>
          )}

          {mode === 'viewer' && (
            <>
              <Button
                variant="contained"
                color="info"
                startIcon={<ScreenShareIcon />}
                onClick={() => requestAccess('view')}
              >
                View Screen
              </Button>

              <Button
                variant="contained"
                color="warning"
                startIcon={<SettingsRemoteIcon />}
                onClick={() => requestAccess('control')}
              >
                Request Control
              </Button>
            </>
          )}
        </div>

        <VideoGrid>
          {/* Host's local video preview */}
          {myStream && (
            <div style={{ position: 'relative', background: 'black', borderRadius: '8px', overflow: 'hidden' }}>
              <Video srcObject={myStream} autoPlay style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          )}

          {/* FIX 3: Render InteractiveVideo for Viewer to send control inputs */}
          {[...peerStreams.entries()].map(([id, { stream }]) => (
            <InteractiveVideo 
              key={id} 
              stream={stream} 
              manager={shareScreenManager} 
              canControl={mode === 'viewer'} // Only viewers can control
            />
          ))}
        </VideoGrid>

      </Wrapper>
    </Backdrop>
  )
}