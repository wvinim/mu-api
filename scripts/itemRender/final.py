import os
from PIL import Image
from render import render
D = r"C:\projects\mu-api\docs\imgs_shop"
WEAP = [["x",180],["y",90],["x",-20],["z",30]]
SH = [["x",-90],["y",-90],["y",25],["x",10]]
ACC = [["x",-60],["z",20]]
jobs = [
 ("Swords","Blade","Sword06",WEAP,(48,84),4),
 ("Staffs","Divine Staff of Archangel","Staff11",WEAP,(60,108),2),
]
shields = [(0,"Small Shield",2),(1,"Horn Shield",2),(2,"Kite Shield",2),(3,"Elven Shield",2),(4,"Buckler",2),(5,"Dragon Slayer Shield",2),
 (6,"Skull Shield",2),(8,"Tower Shield",2),(9,"Plate Shield",2),(12,"Bronze Shield",2),(13,"Dragon Shield",2),(14,"Legendary Shield",3),
 (15,"Grand Soul Shield",3),(16,"Elemental Shield",2)]
for i,n,h in shields:
    m = f"Shield{i+1:02d}" if i < 15 else f"shield{i+1}"
    jobs.append(("Shields",n,m,SH,(68,68) if h==2 else (68,96),4))
for n,m in [("Ring of Ice","Ring01"),("Ring of Poison","Ring02"),("Ring of Fire","firering"),("Ring of Earth","groundring"),("Ring of Wind","windring"),("Ring of Magic","manaring")]:
    jobs.append(("Rings",n,m,ACC,(56,56),4))
for n,m in [("Pendant of Lightning","Necklace01"),("Pendant of Fire","Necklace02"),("Pendant of Ice","icenecklace"),("Pendant of Wind","windnecklace"),("Pendant of Water","waternecklace"),("Pendant of Ability","agnecklace")]:
    jobs.append(("Pendants",n,m,ACC,(56,56),4))
ims=[]
for folder,name,model,steps,box,yoff in jobs:
    os.makedirs(os.path.join(D,folder),exist_ok=True)
    p=os.path.join(D,folder,name+".jpg")
    assert not os.path.exists(p) or folder in ("Shields","Rings","Pendants") or name in ("Blade","Divine Staff of Archangel"), p
    render(model,steps,p,box=box,yoff=yoff); ims.append(Image.open(p))
c=Image.new('RGB',(92*7,119*4))
for i,im in enumerate(ims): c.paste(im,((i%7)*92,(i//7)*119))
c.resize((92*7*3//2,119*4*3//2)).save('out/final_sheet.png')
print(len(jobs))
