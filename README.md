# Model Context Protocol (MCP) Implementation

This is an implementation of the Model Context Protocol (MCP) based on the 2024-11-05 protocol revision. It provides a standardized way for servers to expose resources and tools to clients.

## Features

### Tools Support
- List available tools
- Call tools with arguments
- Receive tool execution results
- Receive notifications when the tool list changes

### Resources Support
- List available resources
- Read resource contents
- Subscribe to resource updates
- Resource templates with URI templates
- Receive notifications when the resource list changes

## Getting Started

### Prerequisites
- Node.js (version 14 or higher)
- npm

### Installation
```bash
npm install
```

### Running the Server
```bash
npm start
```
This starts the MCP server on port 3000 (default).

### Running the Client Example
```bash
npm run client
```
This runs a simple client that connects to the MCP server, lists available tools and resources, and demonstrates basic functionality.

## Protocol Details

### Capabilities
The server supports the following capabilities:
```json
{
  "capabilities": {
    "tools": {
      "listChanged": true
    },
    "resources": {
      "subscribe": true,
      "listChanged": true
    }
  }
}
```

### Supported Endpoints

#### Tools
- `tools/list`: List available tools
- `tools/call`: Call a tool with arguments

#### Resources
- `resources/list`: List available resources
- `resources/read`: Read resource contents
- `resources/subscribe`: Subscribe to resource updates
- `resources/templates/list`: List available resource templates

### Notifications
- `notifications/capabilities`: Server capabilities
- `notifications/resources/list_changed`: Resource list changed
- `notifications/resources/updated`: Resource updated
- `notifications/tools/list_changed`: Tool list changed

## Implementation Notes

This implementation supports all the tools in the `tools.js` file and provides a simple interface for accessing resources on the filesystem. It uses WebSockets for real-time communication between the server and clients.

## License
MIT
