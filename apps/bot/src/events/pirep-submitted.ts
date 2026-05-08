import { type Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, } from 'discord.js';
import { env } from '../env.js';
import { prisma } from '@vam/db';

export type PirepSubmittedPayload = {
  pirepId: string;
  userId: string;
  flightNumber: string;
  departureIcao: string;
  arrivalIcao: string;
  flightTimeMin: number;
  aircraftRegistration: string | null;
  remarks: string | null;

  // ─── Embed enrichment fields (option #17) ──────────────────────
  // Mirrors apps/web/lib/bot-events.ts → PirepSubmittedPayload. All
  // optional so the manual /pireps/new flow (which only supplies a
  // subset) keeps working — null/undefined falls through to the
  // existing minimal layout. ACARS-driven auto-PIREPs supply
  // everything via the M6 → option-#17 enrichment path in
  // generate-pirep.ts.
  pilotName?: string | null;
  aircraftType?: string | null;
  aircraftTitle?: string | null;
  landingRateFpm?: number | null;
  fuelUsedKg?: number | null;
  network?: string | null;
  hasHardLanding?: boolean;
  incidentSeverity?: 'hard' | 'severe' | null;
};

export async function handlePirepSubmitted(
  client: Client,
  payload: PirepSubmittedPayload
) {
  console.log(
    '[event] pirep-submitted:',
    payload.flightNumber,
    payload.departureIcao,
    '→',
    payload.arrivalIcao
  );

  // User mit Discord-Account laden (für Avatar und Mention)
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      accounts: {
        where: { provider: 'discord' },
        select: { providerAccountId: true },
      },
      rank: true,
    },
  });

  if (!user) {
    console.warn('[event] pirep-submitted: user not found', payload.userId);
    return;
  }

  const discordId = user.accounts[0]?.providerAccountId;
  const pilotMention = discordId ? `<@${discordId}>` : user.name ?? 'Unbekannter Pilot';

  // Flugzeit formatieren: 75 → "1h 15min"
  const hours = Math.floor(payload.flightTimeMin / 60);
  const mins = payload.flightTimeMin % 60;
  const flightTime = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

  // ─── Embed enrichment (option #17) ──────────────────────────────
  // Color hierarchy: a hard-landing INCIDENT visually outranks the
  // network-based hue because it's the more relevant signal —
  // pilots/admins scrolling #pireps need to spot crashes at a glance.
  // 0xe74c3c (red) for severe, 0xf39c12 (amber) for hard. Without
  // an incident, color reflects the network so VATSIM/IVAO flights
  // pop against the offline-blue baseline.
  let color = 0x3498db; // default: Offline blue
  if (payload.hasHardLanding && payload.incidentSeverity === 'severe') {
    color = 0xe74c3c;
  } else if (payload.hasHardLanding && payload.incidentSeverity === 'hard') {
    color = 0xf39c12;
  } else if (payload.network === 'VATSIM') {
    color = 0x00b0d8;
  } else if (payload.network === 'IVAO') {
    color = 0xf57f17;
  }

  // Title suffix. Severe = full "💥" because the user just bent metal;
  // hard = ⚠️ as a softer warning. Both are visible without the
  // pilot opening the embed details — the at-a-glance use case.
  let titleSuffix = '';
  if (payload.hasHardLanding) {
    titleSuffix = payload.incidentSeverity === 'severe' ? ' 💥' : ' ⚠️';
  }

  // Aircraft field: combine type + registration + title with sensible
  // fallbacks. The ACARS auto-PIREP path supplies all three for full
  // richness ("A320 / D-ANNE"); the manual /pireps/new flow only
  // supplies registration; super-old or partial records have just
  // title (Asobo's verbose ATC MODEL string). Never render an empty
  // Flugzeug field — em-dash is the agreed null-display.
  let aircraftValue: string;
  if (payload.aircraftType && payload.aircraftRegistration) {
    aircraftValue = `${payload.aircraftType} / ${payload.aircraftRegistration}`;
  } else if (payload.aircraftType) {
    aircraftValue = payload.aircraftType;
  } else if (payload.aircraftRegistration) {
    aircraftValue = payload.aircraftRegistration;
  } else if (payload.aircraftTitle) {
    // Keep title to a reasonable length — some MSFS/Asobo titles are
    // 50+ chars ("Asobo Airbus A320 Lufthansa Star Alliance Livery")
    // and would overflow Discord's embed-field width.
    aircraftValue =
      payload.aircraftTitle.length > 32
        ? payload.aircraftTitle.slice(0, 31) + '…'
        : payload.aircraftTitle;
  } else {
    aircraftValue = '—';
  }

  // Network display: emoji prefix. Lets the column read at a glance.
  // Defensive default to Offline if the field is missing entirely
  // (older /pireps/new payloads pre-#17 won't supply it).
  let networkValue: string | null = null;
  if (payload.network === 'VATSIM') networkValue = '🌐 VATSIM';
  else if (payload.network === 'IVAO') networkValue = '🌐 IVAO';
  else if (payload.network) networkValue = `🔵 ${payload.network}`;

  // Landing rate display. Null/undefined = no field shown at all
  // (manual flow doesn't capture it). When present, prefix an emoji
  // matching the incident-severity tier to make scrolling-recognition
  // easier. Below ~-100 fpm and we call it smooth (feather emoji);
  // -100 to -400 is normal; -400 to -600 firm; -600+ enters INCIDENT
  // territory which we already flagged in title/color above.
  let landingRateValue: string | null = null;
  if (typeof payload.landingRateFpm === 'number') {
    const fpm = payload.landingRateFpm;
    let emoji = '';
    if (payload.hasHardLanding && payload.incidentSeverity === 'severe') {
      emoji = '💥 ';
    } else if (payload.hasHardLanding && payload.incidentSeverity === 'hard') {
      emoji = '⚠️ ';
    } else if (fpm > -100) {
      emoji = '🪶 ';
    }
    landingRateValue = `${emoji}${fpm} fpm`;
  }

  // Fuel: total burn in kg. Round just in case the source isn't
  // already integer (Prisma's Float can have noise from the JS
  // serialization round-trip). Nothing fancier — the ACARS-tracked
  // value is what it is, and admins reviewing the PIREP can dig into
  // the per-phase fuel via the web UI if they need granularity.
  const fuelValue =
    typeof payload.fuelUsedKg === 'number'
      ? `${Math.round(payload.fuelUsedKg)} kg`
      : null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`✈️ ${payload.flightNumber}${titleSuffix}`)
    .setDescription(`${pilotMention} hat einen Flug eingereicht`);

  // Field-add order: build a list and feed it to addFields once. This
  // way conditional fields (Network, Landing, Fuel) don't break the
  // inline-layout — Discord packs sequential inline=true fields into
  // rows of three. The first three (Route / Flugzeit / Network) form
  // row 1; Flugzeug / Landing / Fuel form row 2.
  embed.addFields(
    {
      name: 'Route',
      value: `\`${payload.departureIcao}\` → \`${payload.arrivalIcao}\``,
      inline: true,
    },
    {
      name: 'Flugzeit',
      value: flightTime,
      inline: true,
    },
  );
  if (networkValue) {
    embed.addFields({ name: 'Netzwerk', value: networkValue, inline: true });
  }
  embed.addFields({ name: 'Flugzeug', value: aircraftValue, inline: true });
  if (landingRateValue) {
    embed.addFields({ name: 'Landing Rate', value: landingRateValue, inline: true });
  }
  if (fuelValue) {
    embed.addFields({ name: 'Verbrauch', value: fuelValue, inline: true });
  }

  if (payload.remarks) {
    embed.addFields({
      name: 'Bemerkungen',
      value: payload.remarks.slice(0, 500),
      inline: false,
    });
  }

  if (user.rank) {
    embed.setFooter({ text: `${user.rank.name} · VAM System` });
  } else {
    embed.setFooter({ text: 'VAM System' });
  }

  embed.setTimestamp();

  try {
    const channel = await client.channels.fetch(env.channels.pireps);
    if (!(channel instanceof TextChannel)) {
      console.warn('[event] pirep-submitted: #pireps channel not a text channel');
      return;
    }

    const webButton = new ButtonBuilder()
      .setLabel('Im Web ansehen')
      .setStyle(ButtonStyle.Link)
      .setURL(`${env.web.baseUrl}/pireps/${payload.pirepId}`)
      .setEmoji('🔗');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(webButton);

    const message = await channel.send({ embeds: [embed], components: [row] });
    // Nette Reaktion für Community-Interaktion
    await message.react('👏').catch(() => {
      // Falls Emoji nicht geht — nicht kritisch
    });
  } catch (err) {
    console.error('[event] pirep-submitted: failed to post embed:', err);
  }
}