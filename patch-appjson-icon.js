const fs=require('fs');
const p='F:/Lenovo/ai-studio-ios/app.json';
const j=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
j.expo.icon='./assets/icon.png';
j.expo.splash={ image:'./assets/splash.png', resizeMode:'contain', backgroundColor:'#f5efe6' };
j.expo.ios.icon='./assets/icon.png';
fs.writeFileSync(p, JSON.stringify(j,null,2),'utf8');
console.log('app.json icon updated');
