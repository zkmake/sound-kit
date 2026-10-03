#!/usr/bin/env bash
# Makes the demo's samples from scratch with ffmpeg: no recordings, no licences. Noise is seeded and
# the encodes bit-exact, so a rerun makes the same files. Beds are noise shaped to loop (their level
# wobble has a period that divides the loop length); one-shots are synthesised chirps, partials and
# filtered noise with a 40 ms tail fade. Each sound is peak-normalised to -1 dB, then encoded twice:
# Opus in Ogg (first choice) and AAC in M4A (for Safari versions that can't decode Ogg).
set -euo pipefail
cd "$(dirname "$0")/../public/audio"

RATE=48000
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# name, seconds, filtergraph (an lavfi source chain), kind (bed | shot)
make() {
  local name=$1 seconds=$2 graph=$3 kind=$4
  local raw="$TMP/$name.wav"

  ffmpeg -v error -y -f lavfi -i "$graph" -t "$seconds" -ac 1 -ar $RATE "$raw"

  local peak gain
  peak=$(ffmpeg -v info -i "$raw" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB/\1/p')
  gain=$(echo "-1 - ($peak)" | bc -l)

  local filters="volume=${gain}dB"

  if [ "$kind" = shot ]; then
    filters="$filters,afade=t=out:st=$(printf "%.3f" "$(echo "$seconds - 0.04" | bc -l)"):d=0.04"
  fi

  local bitrate=48k
  [ "$kind" = bed ] && bitrate=64k

  ffmpeg -v error -y -i "$raw" -af "$filters" -fflags +bitexact -flags:a +bitexact -c:a libopus -b:a $bitrate "$name.ogg"
  ffmpeg -v error -y -i "$raw" -af "$filters" -fflags +bitexact -flags:a +bitexact -c:a aac -b:a $bitrate "$name.m4a"
}

# Meadow ------------------------------------------------------------------------------------------
make wind 12 "anoisesrc=c=pink:r=$RATE:a=0.6:seed=1,lowpass=f=650,lowpass=f=900,volume='0.5+0.35*sin(2*PI*t/6)+0.15*sin(2*PI*t/4)':eval=frame" bed

# Three chirps rising, three falling, a quick run of five.
make bird-1 0.6 "aevalsrc='lt(t,0.45)*lt(mod(t,0.15),0.09)*pow(sin(PI*mod(t,0.15)/0.09),2)*sin(2*PI*(3200*mod(t,0.15)+10000*pow(mod(t,0.15),2)))':s=$RATE" shot
make bird-2 0.6 "aevalsrc='lt(t,0.45)*lt(mod(t,0.15),0.1)*pow(sin(PI*mod(t,0.15)/0.1),2)*sin(2*PI*(5600*mod(t,0.15)-12000*pow(mod(t,0.15),2)))':s=$RATE" shot
make bird-3 0.5 "aevalsrc='lt(t,0.4)*lt(mod(t,0.08),0.05)*pow(sin(PI*mod(t,0.08)/0.05),2)*sin(2*PI*(3900*mod(t,0.08)+16000*pow(mod(t,0.08),2)))':s=$RATE" shot
# A skylark: a long warbled trill.
make skylark 1.4 "aevalsrc='pow(sin(PI*t/1.4),2)*(0.7+0.3*sin(2*PI*9*t))*sin(2*PI*4500*t-(800/28)*cos(2*PI*28*t))':s=$RATE" shot

# Café --------------------------------------------------------------------------------------------
make room 12 "anoisesrc=c=brown:r=$RATE:a=0.7:seed=2,bandpass=f=420:width_type=h:w=500,volume='0.7+0.2*sin(2*PI*t/3)+0.1*sin(2*PI*t/2)':eval=frame" bed

# Cup clinks: inharmonic partials, each set a little different.
make cup-1 0.8 "aevalsrc='0.5*sin(2*PI*2400*t)*exp(-11*t)+0.3*sin(2*PI*5900*t)*exp(-19*t)+0.2*sin(2*PI*8330*t)*exp(-28*t)':s=$RATE" shot
make cup-2 0.8 "aevalsrc='0.5*sin(2*PI*2760*t)*exp(-13*t)+0.3*sin(2*PI*6790*t)*exp(-21*t)+0.2*sin(2*PI*9580*t)*exp(-30*t)':s=$RATE" shot
make cup-3 0.9 "aevalsrc='(0.5*sin(2*PI*2100*t)*exp(-10*t)+0.3*sin(2*PI*5170*t)*exp(-18*t))*(1+gte(t,0.12)*0.8*exp(-12*(t-0.12)))':s=$RATE" shot
# The register's bell, and a chair scraping.
make bell 1.6 "aevalsrc='0.5*sin(2*PI*1318*t)*exp(-2.5*t)+0.25*sin(2*PI*3163*t)*exp(-4*t)+0.15*sin(2*PI*5140*t)*exp(-6*t)':s=$RATE" shot
make chair 0.7 "anoisesrc=c=white:r=$RATE:a=0.8:seed=3,bandpass=f=1100:width_type=q:w=3,tremolo=f=38:d=0.7,volume='min(t/0.04,1)*exp(-3*t)':eval=frame" shot

# Night -------------------------------------------------------------------------------------------
make night 12 "anoisesrc=c=brown:r=$RATE:a=0.5:seed=4,lowpass=f=320,volume='0.8+0.2*sin(2*PI*t/4)':eval=frame" bed
make cricket-1 1.2 "aevalsrc='lt(mod(t,0.4),0.15)*lt(mod(t,0.05),0.022)*sin(2*PI*4600*t)':s=$RATE" shot
make cricket-2 1.0 "aevalsrc='lt(mod(t,0.33),0.2)*lt(mod(t,0.04),0.018)*sin(2*PI*4950*t)':s=$RATE" shot
# An owl: a short hoot, then a long one, a little lower.
make owl 1.3 "aevalsrc='lt(t,0.3)*pow(sin(PI*t/0.3),2)*sin(2*PI*390*t+3*sin(2*PI*5*t))+gte(t,0.5)*lt(t,1.25)*pow(sin(PI*(t-0.5)/0.75),2)*sin(2*PI*362*t+4*sin(2*PI*5*t))':s=$RATE" shot

# Mixer demo -------------------------------------------------------------------------------------
# Footsteps: short low thumps of filtered noise, each a little different.
make step-1 0.22 "anoisesrc=c=brown:r=$RATE:a=0.9:seed=11,lowpass=f=420,volume='min(t/0.004,1)*exp(-26*t)':eval=frame" shot
make step-2 0.22 "anoisesrc=c=brown:r=$RATE:a=0.9:seed=23,lowpass=f=520,volume='min(t/0.004,1)*exp(-30*t)':eval=frame" shot
make step-3 0.22 "anoisesrc=c=brown:r=$RATE:a=0.9:seed=37,lowpass=f=380,volume='min(t/0.004,1)*exp(-24*t)':eval=frame" shot
make step-4 0.22 "anoisesrc=c=brown:r=$RATE:a=0.9:seed=41,lowpass=f=600,volume='min(t/0.004,1)*exp(-32*t)':eval=frame" shot
# A coin: two quick bell tones, a fifth apart.
make coin 0.5 "aevalsrc='0.6*sin(2*PI*1568*t)*exp(-14*t)*lt(t,0.07)+0.6*gte(t,0.07)*sin(2*PI*2349*t)*exp(-9*(t-0.07))':s=$RATE" shot
# A boom: a low sine drop under a noise burst.
make boom 1.2 "aevalsrc='0.9*sin(2*PI*(70*t-12*t*t))*exp(-3.5*t)':s=$RATE,volume=1" shot
# A UI click.
make click 0.05 "aevalsrc='sin(2*PI*1900*t)*exp(-120*t)':s=$RATE" shot
# An engine loop: harmonics of 55 Hz with a 4-stroke wobble; 2 s holds whole cycles of both, so it loops clean.
make engine 2 "aevalsrc='(0.5*sin(2*PI*55*t)+0.3*sin(2*PI*110*t)+0.2*sin(2*PI*165*t)+0.12*sin(2*PI*220*t))*(0.75+0.25*sin(2*PI*13.5*t))':s=$RATE" bed
# Two music loops, 16 s each: plucked arpeggios over a bass, in C and in A minor.
make track-a 16 "aevalsrc='0.35*min(mod(t,0.25)/0.005,1)*exp(-12*mod(t,0.25))*sin(2*PI*261.63*pow(2,((eq(mod(floor(t/4),4),1)*-3+eq(mod(floor(t/4),4),2)*5+eq(mod(floor(t/4),4),3)*7)+eq(mod(floor(t*4),4),1)*4+eq(mod(floor(t*4),4),2)*7+eq(mod(floor(t*4),4),3)*12)/12)*t)+0.3*min(mod(t,0.5)/0.01,1)*exp(-4*mod(t,0.5))*sin(2*PI*65.41*pow(2,(eq(mod(floor(t/4),4),1)*-3+eq(mod(floor(t/4),4),2)*5+eq(mod(floor(t/4),4),3)*7)/12)*t)':s=$RATE" bed
make track-b 16 "aevalsrc='0.3*min(mod(t,0.3333)/0.005,1)*exp(-9*mod(t,0.3333))*sin(2*PI*220*pow(2,((eq(mod(floor(t/4),4),1)*-4+eq(mod(floor(t/4),4),2)*-2+eq(mod(floor(t/4),4),3)*-5)+eq(mod(floor(t*3),3),1)*3+eq(mod(floor(t*3),3),2)*7)/12)*t)+0.3*min(mod(t,1)/0.01,1)*exp(-2.5*mod(t,1))*sin(2*PI*55*pow(2,(eq(mod(floor(t/4),4),1)*-4+eq(mod(floor(t/4),4),2)*-2+eq(mod(floor(t/4),4),3)*-5)/12)*t)':s=$RATE" bed

ls -la
