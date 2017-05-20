/*
 The BSD 3-Clause License

 Copyright 2016,2017 - Klaus Landsdorf (http://bianco-royal.de/)
 Copyright 2015,2016 - Mika Karaila, Valmet Automation Inc. (node-red-contrib-opcua)
 All rights reserved.
 node-red-iiot-opcua
 */
'use strict'

/**
 * Write Node-RED node.
 *
 * @param RED
 */
module.exports = function (RED) {
  let coreClient = require('./core/opcua-iiot-core-client')

  function OPCUAIIoTWrite (config) {
    RED.nodes.createNode(this, config)
    this.name = config.name
    this.showStatusActivities = config.showStatusActivities
    this.showErrors = config.showErrors
    this.connector = RED.nodes.getNode(config.connector)

    let node = this
    node.reconnectTimeout = 1000

    node.verboseLog = function (logMessage) {
      if (RED.settings.verbose) {
        coreClient.writeDebugLog(logMessage)
      }
    }

    node.statusLog = function (logMessage) {
      if (RED.settings.verbose && node.showStatusActivities) {
        node.verboseLog('Status: ' + logMessage)
      }
    }

    node.setNodeStatusTo = function (statusValue) {
      node.statusLog(statusValue)
      let statusParameter = coreClient.core.getNodeStatus(statusValue, node.showStatusActivities)
      node.status({fill: statusParameter.fill, shape: statusParameter.shape, text: statusParameter.status})
    }

    node.handleWriteError = function (err, msg) {
      node.verboseLog('ERROR: ' + err)

      if (node.showErrors) {
        node.error(err, msg)
      }

      node.setNodeStatusTo('error')
    }

    node.writeToSession = function (session, msg) {
      if (session) {
        if (session.sessionId === 'terminated') {
          node.handleWriteError(new Error('Session Terminated'), msg)
        } else {
          let nodesToWrite = coreClient.core.buildNodesToWrite(msg)

          coreClient.write(session, nodesToWrite).then(function (writeResult) {
            node.setNodeStatusTo('active')

            if (writeResult.results) {
              writeResult.results.forEach(function (result) {
                coreClient.writeDebugLog('Write Result: ' + JSON.stringify(result))
              })
            }

            if (writeResult.diagnostics) {
              writeResult.diagnostics.forEach(function (diagnostic) {
                coreClient.writeDebugLog('Write Diagnostic: ' + JSON.stringify(diagnostic))
              })
            }

            let message = {
              payload: writeResult.resultsConverted,
              nodesToWrite: JSON.stringify(nodesToWrite),
              input: msg,
              resultsConverted: writeResult.resultsConverted,
              /* results: writeResult.results, */
              diagnostics: writeResult.diagnostics,
              nodetype: 'write'
            }
            coreClient.writeDebugLog('Write Send Message: ' + JSON.stringify(message))
            node.send(message)
          }).catch(function (err) {
            coreClient.writeDebugLog(err)
            node.handleWriteError(err, msg)
          })
        }
      } else {
        node.handleWriteError(new Error('Session Not Valid On Write'), msg)
      }
    }

    node.on('input', function (msg) {
      coreClient.writeDebugLog(JSON.stringify(msg))
      node.writeToSession(node.opcuaSession, msg)
    })

    node.handleSessionError = function (err) {
      if (node.showErrors) {
        node.error(err, {payload: 'Write Session Error'})
      }

      coreClient.internalDebugLog('Reconnect in ' + node.reconnectTimeout + ' msec.')
      node.connector.closeSession(node.opcuaSession, function () {
        setTimeout(function () {
          node.startOPCUASession(node.opcuaClient)
        }, node.reconnectTimeout)
      })
    }

    node.startOPCUASession = function (opcuaClient) {
      coreClient.writeDebugLog('Write Start OPC UA Session')
      node.opcuaClient = opcuaClient
      node.connector.startSession(coreClient.core.TEN_SECONDS_TIMEOUT, 'Write Node').then(function (session) {
        node.opcuaSession = session
        coreClient.writeDebugLog('Session Connected')
        node.setNodeStatusTo('connected')
      }).catch(node.handleSessionError)
    }

    if (node.connector) {
      node.connector.on('connected', node.startOPCUASession)
    } else {
      throw new TypeError('Connector Not Valid')
    }

    node.on('close', function (done) {
      if (node.opcuaSession) {
        node.connector.closeSession(node.opcuaSession, function (err) {
          if (err) {
            coreClient.writeDebugLog('Error On Close Session ' + err)
          }
          node.opcuaSession = null
          done()
        })
      } else {
        node.opcuaSession = null
        done()
      }
    })

    node.setNodeStatusTo('waiting')
  }

  RED.nodes.registerType('OPCUA-IIoT-Write', OPCUAIIoTWrite)
}
