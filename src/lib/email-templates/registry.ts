import type { ComponentType } from 'react'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
import { template as sopDocumentTemplate } from './sop-document'
import { template as topicSubmittedTemplate } from './topic-submitted'
import { template as topicSelectedTemplate } from './topic-selected'
import { template as vaultPacketTemplate } from './vault-packet'
import { template as memberAnnouncementTemplate } from './member-announcement'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'sop-document': sopDocumentTemplate,
  'topic-submitted': topicSubmittedTemplate,
  'topic-selected': topicSelectedTemplate,
  'vault-packet': vaultPacketTemplate,
  'member-announcement': memberAnnouncementTemplate,
}
