import { memo, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';

import type { AvatarConfig } from '@/api/types';
import { useTheme } from '@/theme/ThemeProvider';
import { DEFAULT_AVATAR, shade } from './options';

type Props = {
  config?: Partial<AvatarConfig> | null;
  size?: number;
  /** 0..1 — opens the mouth while the person is speaking. */
  talking?: number;
  showBg?: boolean;
  online?: boolean | null;
  label?: string;
};

const INK = '#1E1B2E';

function Hair({ style, color, layer }: { style: string; color: string; layer: 'back' | 'front' }) {
  const dark = shade(color, -0.18);
  if (layer === 'back') {
    switch (style) {
      case 'bob':
        return <Path d="M26 44 C24 24 36 16 50 16 C64 16 76 24 74 44 L75 62 C70 65 66 64 63 60 L63 46 L37 46 L37 60 C34 64 30 65 25 62 Z" fill={dark} />;
      case 'long':
        return <Path d="M25 44 C23 22 37 15 50 15 C63 15 77 22 75 44 L78 84 C70 88 62 86 60 80 L60 52 L40 52 L40 80 C38 86 30 88 22 84 Z" fill={dark} />;
      case 'afro':
        return <Circle cx={50} cy={36} r={29} fill={color} />;
      case 'braids':
        return (
          <G fill={dark}>
            {[54, 61, 68, 75, 82].map((y) => (
              <G key={y}>
                <Ellipse cx={29} cy={y} rx={4.6} ry={4.2} />
                <Ellipse cx={71} cy={y} rx={4.6} ry={4.2} />
              </G>
            ))}
          </G>
        );
      default:
        return null;
    }
  }
  switch (style) {
    case 'curlyTop':
      return (
        <G fill={color}>
          {[
            [33, 31, 8],
            [41, 24, 9],
            [51, 22, 9.5],
            [61, 25, 9],
            [68, 32, 7.5],
            [29, 39, 6],
            [71, 40, 6],
          ].map(([cx, cy, r]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
          ))}
        </G>
      );
    case 'bob':
      return <Path d="M29 39 C30 25 40 19 50 19 C60 19 70 25 71 39 C64 32 57 30 50 30 C43 30 36 32 29 39 Z" fill={color} />;
    case 'long':
      return <Path d="M28 41 C29 24 41 18 52 19 C63 20 71 28 72 41 C66 30 56 27 46 30 C39 32 33 36 28 41 Z" fill={color} />;
    case 'bun':
      return (
        <G fill={color}>
          <Circle cx={50} cy={15} r={9} />
          <Path d="M29 40 C29 25 39 19 50 19 C61 19 71 25 71 40 C66 32 59 29 50 29 C41 29 34 32 29 40 Z" />
        </G>
      );
    case 'buzz':
      return <Path d="M30 37 C30 25 39 20 50 20 C61 20 70 25 70 37 C66 31 59 28 50 28 C41 28 34 31 30 37 Z" fill={color} opacity={0.85} />;
    case 'afro':
      return <Path d="M30 36 C33 28 41 25 50 25 C59 25 67 28 70 36 C64 33 57 32 50 32 C43 32 36 33 30 36 Z" fill={dark} />;
    case 'braids':
    case 'short':
      return <Path d="M29 41 C28 25 38 18 50 18 C63 18 72 25 71 41 C68 32 60 28 50 29 C41 29 33 32 29 41 Z" fill={color} />;
    case 'spiky':
      return <Path d="M28 41 L31 24 L38 30 L42 15 L48 27 L54 13 L58 27 L64 17 L66 30 L72 25 L71 41 C65 32 58 29 50 29 C42 29 35 32 28 41 Z" fill={color} />;
    case 'mohawk':
      return (
        <G>
          <Path d="M30 37 C30 25 39 20 50 20 C61 20 70 25 70 37 C66 31 59 28 50 28 C41 28 34 31 30 37 Z" fill={color} opacity={0.35} />
          <Path d="M44 31 C44 19 46 9 50 7 C54 9 56 19 56 31 Z" fill={color} />
        </G>
      );
    default:
      return null;
  }
}

function Outfit({ style, color, skin }: { style: string; color: string; skin: string }) {
  const dark = shade(color, -0.2);
  const light = shade(color, 0.25);
  const body = 'M14 100 C14 82 28 72 50 72 C72 72 86 82 86 100 Z';
  switch (style) {
    case 'hoodie':
      return (
        <G>
          <Path d={body} fill={color} />
          <Path d="M33 75 C35 66 65 66 67 75 C60 80 40 80 33 75 Z" fill={dark} />
          <Path d="M46 79 L45 90 M54 79 L55 90" stroke="#F5F5FB" strokeWidth={1.6} strokeLinecap="round" />
        </G>
      );
    case 'collar':
      return (
        <G>
          <Path d={body} fill={color} />
          <Path d="M41 72 L50 82 L43 86 Z M59 72 L50 82 L57 86 Z" fill="#F5F5FB" />
          <Circle cx={50} cy={90} r={1.3} fill={dark} />
          <Circle cx={50} cy={96} r={1.3} fill={dark} />
        </G>
      );
    case 'sweater':
      return (
        <G>
          <Path d={body} fill={color} />
          <Rect x={14} y={86} width={72} height={4} fill={light} />
          <Rect x={14} y={93} width={72} height={4} fill={light} />
          <Path d="M42 72 C44 78 56 78 58 72" fill={skin} />
        </G>
      );
    case 'jacket':
      return (
        <G>
          <Path d={body} fill={color} />
          <Path d="M14 100 C14 86 20 78 30 75 L32 100 Z M86 100 C86 86 80 78 70 75 L68 100 Z" fill={dark} />
          <Path d="M44 73 L56 73 L54 100 L46 100 Z" fill="#F5F5FB" />
          <Path d="M44 73 L46 100 M56 73 L54 100" stroke={light} strokeWidth={1.5} />
        </G>
      );
    case 'overalls':
      return (
        <G>
          <Path d={body} fill="#F5F5FB" />
          <Path d="M34 84 L66 84 L68 100 L32 100 Z" fill={color} />
          <Path d="M36 76 L38 86 M64 76 L62 86" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
          <Circle cx={39} cy={87} r={1.4} fill={dark} />
          <Circle cx={61} cy={87} r={1.4} fill={dark} />
        </G>
      );
    case 'star':
      return (
        <G>
          <Path d={body} fill={color} />
          <Path d="M42 72 C44 78 56 78 58 72" fill={skin} />
          <Path d="M50 82 L52.6 87.4 L58.5 88.1 L54.2 92.1 L55.3 98 L50 95.1 L44.7 98 L45.8 92.1 L41.5 88.1 L47.4 87.4 Z" fill="#FFC857" />
        </G>
      );
    case 'tee':
    default:
      return (
        <G>
          <Path d={body} fill={color} />
          <Path d="M42 72 C44 78 56 78 58 72" fill={skin} />
        </G>
      );
  }
}

function Eyes({ style }: { style: string }) {
  const stroke = { stroke: INK, strokeWidth: 2.1, strokeLinecap: 'round' as const, fill: 'none' };
  switch (style) {
    case 'happy':
      return <Path d="M38.5 47 Q42 43 45.5 47 M54.5 47 Q58 43 61.5 47" {...stroke} />;
    case 'sleepy':
      return <Path d="M38.5 46 Q42 48.5 45.5 46 M54.5 46 Q58 48.5 61.5 46" {...stroke} />;
    case 'wink':
      return (
        <G>
          <Circle cx={42} cy={46} r={2.8} fill={INK} />
          <Path d="M54.5 47 Q58 43 61.5 47" {...stroke} />
        </G>
      );
    case 'sparkle':
      return (
        <G>
          <Circle cx={42} cy={46} r={3.3} fill={INK} />
          <Circle cx={58} cy={46} r={3.3} fill={INK} />
          <Circle cx={43.2} cy={44.8} r={1.1} fill="#FFFFFF" />
          <Circle cx={59.2} cy={44.8} r={1.1} fill="#FFFFFF" />
        </G>
      );
    case 'round':
    default:
      return (
        <G fill={INK}>
          <Circle cx={42} cy={46} r={2.8} />
          <Circle cx={58} cy={46} r={2.8} />
        </G>
      );
  }
}

function Brows({ style, color }: { style: string; color: string }) {
  const props = { stroke: shade(color, -0.25), strokeWidth: 1.8, strokeLinecap: 'round' as const, fill: 'none' };
  if (style === 'raised') return <Path d="M38 37.5 Q42 34.5 46 37.5 M54 37.5 Q58 34.5 62 37.5" {...props} />;
  if (style === 'flat') return <Path d="M38.5 39 L45.5 39 M54.5 39 L61.5 39" {...props} />;
  return <Path d="M38 39.5 Q42 37.5 46 39.5 M54 39.5 Q58 37.5 62 39.5" {...props} />;
}

function Mouth({ style, talking }: { style: string; talking: number }) {
  if (talking > 0.05) {
    const ry = 1.4 + talking * 4;
    return (
      <G>
        <Ellipse cx={50} cy={56} rx={4.2} ry={ry} fill="#5A1F2B" />
        {ry > 3 ? <Ellipse cx={50} cy={56 + ry * 0.45} rx={2.4} ry={ry * 0.35} fill="#E8798A" /> : null}
      </G>
    );
  }
  switch (style) {
    case 'grin':
      return (
        <G>
          <Path d="M43 54 Q50 63 57 54 Z" fill="#5A1F2B" />
          <Path d="M44.5 54.6 L55.5 54.6 L54.6 56.2 L45.4 56.2 Z" fill="#FFFFFF" />
        </G>
      );
    case 'calm':
      return <Path d="M46 56.5 Q50 57.5 54 56.5" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />;
    case 'open':
      return <Ellipse cx={50} cy={56.5} rx={3.2} ry={2.8} fill="#5A1F2B" />;
    case 'smile':
    default:
      return <Path d="M44 54.5 Q50 60 56 54.5" stroke={INK} strokeWidth={2.1} strokeLinecap="round" fill="none" />;
  }
}

function Accessory({ style, accent }: { style: string; accent: string }) {
  switch (style) {
    case 'glasses':
      return (
        <G stroke={INK} strokeWidth={1.6} fill="rgba(255,255,255,0.15)">
          <Circle cx={42} cy={46} r={6} />
          <Circle cx={58} cy={46} r={6} />
          <Path d="M48 46 L52 46" fill="none" />
        </G>
      );
    case 'sunglasses':
      return (
        <G>
          <Rect x={35} y={41.5} width={13} height={9} rx={3.5} fill={INK} />
          <Rect x={52} y={41.5} width={13} height={9} rx={3.5} fill={INK} />
          <Path d="M48 45 L52 45" stroke={INK} strokeWidth={1.8} />
          <Path d="M38 44 L42 43" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.6} />
        </G>
      );
    case 'headphones':
      return (
        <G>
          <Path d="M26 46 C25 17 75 17 74 46" stroke={INK} strokeWidth={3.6} fill="none" strokeLinecap="round" />
          <Rect x={21.5} y={39} width={8} height={15} rx={4} fill={accent} />
          <Rect x={70.5} y={39} width={8} height={15} rx={4} fill={accent} />
        </G>
      );
    case 'cap':
      return (
        <G>
          <Path d="M28 35 C28 19 72 19 72 35 Z" fill={accent} />
          <Path d="M48 33 L83 35 C81 39 60 38 48 37 Z" fill={shade(accent, -0.2)} />
          <Circle cx={50} cy={21.5} r={1.8} fill={shade(accent, -0.25)} />
        </G>
      );
    case 'beanie':
      return (
        <G>
          <Path d="M27 37 C27 15 73 15 73 37 Z" fill={accent} />
          <Rect x={26} y={32} width={48} height={7} rx={3.5} fill={shade(accent, -0.2)} />
          <Circle cx={50} cy={13.5} r={4.5} fill={shade(accent, 0.3)} />
        </G>
      );
    case 'flower':
      return (
        <G>
          {[0, 72, 144, 216, 288].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            return <Circle key={deg} cx={68 + Math.cos(rad) * 3.4} cy={27 + Math.sin(rad) * 3.4} r={3} fill="#FF8FB1" />;
          })}
          <Circle cx={68} cy={27} r={2.3} fill="#FFC857" />
        </G>
      );
    case 'scarf':
      return (
        <G>
          <Path d="M55 72 L60 92 L53.5 93 L50 74 Z" fill="#C96A41" />
          <Path d="M32 65 C40 72 60 72 68 65 L69.5 73 C60 80 40 80 30.5 73 Z" fill="#E8875B" />
          <Path d="M38 70.5 L38.5 77 M46 72.5 L46 79 M54 72.5 L54 79 M62 70.5 L61.5 77" stroke="#C96A41" strokeWidth={1.6} strokeLinecap="round" />
          <Path d="M54.5 86 L60.5 85.2 M53.5 82 L59.5 81.2" stroke="#F5F5FB" strokeWidth={1.2} opacity={0.7} />
        </G>
      );
    case 'crown':
      return (
        <G>
          <Path d="M36 23 L39 10 L45.5 18 L50 7 L54.5 18 L61 10 L64 23 Z" fill="#FFC857" />
          <Circle cx={50} cy={17} r={1.8} fill="#FF6B7A" />
        </G>
      );
    default:
      return null;
  }
}

/** Cartoon avatar drawn from preset parts. Veyvo never uses photos. */
export const Avatar = memo(function Avatar({ config, size = 48, talking = 0, showBg = true, online, label }: Props) {
  const { colors } = useTheme();
  const c = { ...DEFAULT_AVATAR, ...(config ?? {}) } as AvatarConfig;
  const clipId = `clip${useId().replace(/:/g, '')}`;
  const skinShadow = shade(c.skin, -0.12);
  const accent = c.outfitColor === c.bg ? colors.accent : shade(c.outfitColor, 0.1);

  return (
    <View style={{ width: size, height: size }} accessible={!!label} accessibilityRole={label ? 'image' : undefined} accessibilityLabel={label}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <ClipPath id={clipId}>
            <Circle cx={50} cy={50} r={50} />
          </ClipPath>
        </Defs>
        <G clipPath={showBg ? `url(#${clipId})` : undefined}>
          {showBg ? <Rect x={0} y={0} width={100} height={100} fill={c.bg} /> : null}
          <Hair style={c.hair} color={c.hairColor} layer="back" />
          <Outfit style={c.outfit} color={c.outfitColor} skin={c.skin} />
          <Rect x={43} y={60} width={14} height={15} rx={5} fill={skinShadow} />
          <Circle cx={28.5} cy={47} r={4.5} fill={c.skin} />
          <Circle cx={71.5} cy={47} r={4.5} fill={c.skin} />
          <Ellipse cx={50} cy={44} rx={21.5} ry={23} fill={c.skin} />
          <Hair style={c.hair} color={c.hairColor} layer="front" />
          <Circle cx={36.5} cy={53} r={3.4} fill="#FF8F9A" opacity={0.35} />
          <Circle cx={63.5} cy={53} r={3.4} fill="#FF8F9A" opacity={0.35} />
          <Brows style={c.brows} color={c.hairColor} />
          <Eyes style={c.eyes} />
          <Mouth style={c.mouth} talking={talking} />
          <Accessory style={c.accessory} accent={accent} />
        </G>
      </Svg>
      {online ? (
        <View
          style={[
            styles.dot,
            { width: Math.max(10, size * 0.24), height: Math.max(10, size * 0.24), borderRadius: size, backgroundColor: colors.success, borderColor: colors.bg },
          ]}
          accessibilityLabel="Online"
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  dot: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2 },
});
