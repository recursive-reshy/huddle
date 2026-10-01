// Packages
import { z } from 'zod'

export const agentId = z.enum( [ 'human', 'pm', 'sa', 'dba', 'ca' ] )
export type AgentId = z.infer< typeof agentId >

// human is an agent but never a thread
export const threadId = z.enum( [ 'pm', 'sa' ] )
export type ThreadId = z.infer< typeof threadId >
