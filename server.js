const cmd = `
ffmpeg -y -loop 1 -i ${imgPath} \
-vf "
scale=1080:1920,
format=yuv420p,

zoompan=
z='1.045 + 0.018*sin(2*PI*on/420)'
brightness=0.02*sin(2*PI*on/300)
noise alls=7
x='iw/2-(iw/zoom/2) + 6*sin(2*PI*on/600)':
y='ih/2-(ih/zoom/2) + 4*cos(2*PI*on/520)':
d=480:s=1080x1920,

eq=
brightness=0.015*sin(2*PI*on/360):
contrast=1.02:
saturation=1.03,

noise=
alls=6:
allf=t,

fps=30
" \
-t 16 -movflags +faststart ${outPath}
`;
