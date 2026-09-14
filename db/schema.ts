import { sqliteTable,text,integer,index,uniqueIndex } from 'drizzle-orm/sqlite-core';
export const trips=sqliteTable('trips',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),name:text('name').notNull(),startDate:text('start_date').notNull(),endDate:text('end_date').notNull(),
},t=>[index('trips_owner').on(t.userId)]);
export const receipts=sqliteTable('receipts',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),source:text('source').notNull(),date:text('date').notNull(),merchant:text('merchant').notNull(),amount:integer('amount').notNull(),reference:text('reference').notNull().default(''),raw:text('raw').notNull().default(''),sourceUrl:text('source_url').notNull().default(''),fingerprint:text('fingerprint').notNull(),tripId:text('trip_id').references(()=>trips.id),reviewed:integer('reviewed').notNull().default(0),attachmentKey:text('attachment_key'),attachmentName:text('attachment_name'),attachmentType:text('attachment_type'),createdAt:text('created_at').notNull(),
},t=>[index('receipts_owner_date').on(t.userId,t.date),uniqueIndex('receipts_owner_fingerprint').on(t.userId,t.fingerprint)]);
export const reportSettings=sqliteTable('report_settings',{userId:text('user_id').primaryKey(),config:text('config').notNull(),templateKey:text('template_key'),templateName:text('template_name')});
export const reportShares=sqliteTable('report_shares',{id:text('id').primaryKey(),userId:text('user_id').notNull(),tokenHash:text('token_hash').notNull(),fileKey:text('file_key').notNull(),filename:text('filename').notNull(),expiresAt:text('expires_at').notNull(),createdAt:text('created_at').notNull()},t=>[uniqueIndex('report_share_token').on(t.tokenHash),index('report_share_owner').on(t.userId)]);

