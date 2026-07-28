/**
 * Seed demo data for BramhaV2 MVP demo.
 *
 * Creates:
 *   - user: demo@northwind.com / Northwind2025!
 *   - org: Northwind
 *   - project: Q3 Strategy (member: demo user as admin)
 *   - room 1: Strategy Session (council, kind=council)
 *   - room 2: Vulcan 1:1 (kind=one_on_one, persona=cto)
 *   - main branch for each room
 *   - file: market-research.pdf (status=ready, 3 chunks with zero vectors)
 *   - open loop in Vulcan 1:1 (backdated 25h, persona=cto)
 *
 * Usage: pnpm seed:demo
 */

import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { getDb, users, orgs, orgMembers, projects, projectMembers, rooms, branches, files } from '@bramha/db';
import { migrate } from '@bramha/db';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const DEMO_EMAIL = 'demo@northwind.com';
const DEMO_PASSWORD = 'Northwind2025!';
const DEMO_NAME = 'Demo User';

async function main(): Promise<void> {
  // Run migrations first so schema is up to date
  await migrate();

  const db = await getDb();

  // --- Idempotency check ---
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL));
  if (existingUser) {
    console.log('Demo already seeded. Run pnpm seed:demo:reset first.');
    process.exit(0);
  }

  // 1. Hash password
  const passwordHash = await argon2.hash(DEMO_PASSWORD, ARGON2_OPTIONS);

  // 2. Insert user
  const [user] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      passwordHash,
      emailVerifiedAt: new Date(),
      isAdmin: true, // demo account is the godmode admin
    })
    .returning();
  if (!user) throw new Error('Failed to insert user');
  const userId = user.id;
  console.log(`Created user: ${DEMO_EMAIL} (${userId})`);

  // 3. Insert org
  const [org] = await db
    .insert(orgs)
    .values({
      name: 'Northwind',
      slug: 'northwind',
      createdBy: userId,
    })
    .returning();
  if (!org) throw new Error('Failed to insert org');
  const orgId = org.id;
  console.log(`Created org: Northwind (${orgId})`);

  // 4. Insert org_members
  await db.insert(orgMembers).values({
    orgId,
    userId,
    role: 'owner',
  });
  console.log('Added user as org owner');

  // 5. Insert project
  const [project] = await db
    .insert(projects)
    .values({
      orgId,
      name: 'Q3 Strategy',
      slug: 'q3-strategy',
      proactivePaEnabled: true,
    })
    .returning();
  if (!project) throw new Error('Failed to insert project');
  const projectId = project.id;
  console.log(`Created project: Q3 Strategy (${projectId})`);

  // 6. Insert project_members (role: admin per 0002 migration)
  await db.insert(projectMembers).values({
    projectId,
    userId,
    role: 'admin',
  });
  console.log('Added user as project admin');

  // 7. Insert room 1: Strategy Session (council)
  const [room1] = await db
    .insert(rooms)
    .values({
      projectId,
      name: 'Strategy Session',
      kind: 'council',
      persona: null,
    })
    .returning();
  if (!room1) throw new Error('Failed to insert room 1');
  const room1Id = room1.id;
  console.log(`Created room 1: Strategy Session (${room1Id})`);

  // 8. Insert room 2: Vulcan 1:1 (one_on_one, persona=cto)
  const [room2] = await db
    .insert(rooms)
    .values({
      projectId,
      name: 'Vulcan 1:1',
      kind: 'one_on_one',
      persona: 'cto',
    })
    .returning();
  if (!room2) throw new Error('Failed to insert room 2');
  const room2Id = room2.id;
  console.log(`Created room 2: Vulcan 1:1 (${room2Id})`);

  // 9. Insert main branch for room 1
  const [branch1] = await db
    .insert(branches)
    .values({
      roomId: room1Id,
      projectId,
      name: 'main',
      headNodeId: null,
      createdBy: userId,
    })
    .returning();
  if (!branch1) throw new Error('Failed to insert branch 1');
  const branch1Id = branch1.id;

  // Wire room 1 -> main_branch_id
  await db.update(rooms).set({ mainBranchId: branch1Id }).where(eq(rooms.id, room1Id));
  console.log(`Created branch 1: main (${branch1Id})`);

  // 10. Insert main branch for room 2
  const [branch2] = await db
    .insert(branches)
    .values({
      roomId: room2Id,
      projectId,
      name: 'main',
      headNodeId: null,
      createdBy: userId,
    })
    .returning();
  if (!branch2) throw new Error('Failed to insert branch 2');
  const branch2Id = branch2.id;

  // Wire room 2 -> main_branch_id
  await db.update(rooms).set({ mainBranchId: branch2Id }).where(eq(rooms.id, room2Id));
  console.log(`Created branch 2: main (${branch2Id})`);

  // 11. Insert file record
  const [file] = await db
    .insert(files)
    .values({
      projectId,
      filename: 'market-research.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 51200,
      storagePath: 'demo/market-research.pdf',
      status: 'ready',
      uploadedBy: userId,
    })
    .returning();
  if (!file) throw new Error('Failed to insert file');
  const fileId = file.id;
  console.log(`Created file: market-research.pdf (${fileId})`);

  // 12. Insert 3 file chunks with zero vectors
  const chunks = [
    'Q3 market research shows e-commerce growing 23% YoY. Mobile first strategy critical.',
    'Competitor analysis: Three main players control 67% market share. Differentiation through AI tooling is a gap.',
    'Recommended Q3 priorities: (1) data infrastructure, (2) AI integrations, (3) user retention improvement.',
  ];

  const zeroVector = JSON.stringify(Array(1536).fill(0));

  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i]!;
    const tokenCount = Math.ceil(content.length / 4);
    await db.execute(sql`
      INSERT INTO file_chunks (id, file_id, project_id, chunk_index, content, token_count, embedding)
      VALUES (
        gen_random_uuid(),
        ${fileId},
        ${projectId},
        ${i},
        ${content},
        ${tokenCount},
        ${zeroVector}::vector
      )
    `);
    console.log(`  Inserted chunk ${i}: "${content.slice(0, 50)}..."`);
  }

  // 13. Insert backdated open loop into working_memory
  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const workingMemory = {
    open_loops: [
      {
        roomId: room2Id,
        persona: 'cto',
        text: 'Let me know if you want me to dig deeper into the data infrastructure options.',
        nodeId: '00000000-0000-0000-0000-000000000001',
        createdAt: twentyFiveHoursAgo,
      },
    ],
  };

  await db
    .update(projects)
    .set({ workingMemory })
    .where(eq(projects.id, projectId));
  console.log(`Seeded open loop in Vulcan 1:1 (backdated 25h)`);

  console.log('\nDemo seed complete!');
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log(`  Org:      Northwind`);
  console.log(`  Project:  Q3 Strategy`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
