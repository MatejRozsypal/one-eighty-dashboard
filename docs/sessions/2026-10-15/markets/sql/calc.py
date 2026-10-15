# derived ratios from Q1/Q2/Q3 results
q1 = {  # (client,market,period): new, revenue
 ('dobias','US','L90'):(663,455788),('dobias','US','P90'):(609,444069),('dobias','US','L12M'):(2551,1781389),
 ('dobias','CA','L90'):(242,193183),('dobias','CA','P90'):(157,144536),('dobias','CA','L12M'):(656,627389),
 ('ethia','CZ','L90'):(147,292178),('ethia','CZ','P90'):(103,274421),('ethia','CZ','L12M'):(908,1504953),('ethia','CZ','P12M'):(369,407473),
 ('manami','CZ','L90'):(542,684301),('manami','CZ','P90'):(533,632957),('manami','CZ','L12M'):(1571,1927820),
 ('manami','SK','L90'):(64,71960),('manami','SK','P90'):(59,72371),('manami','SK','L12M'):(309,339436),
 ('rawbark','CZ','L90'):(325,4245712),('rawbark','CZ','P90'):(405,4583180),('rawbark','CZ','L12M'):(1627,19306240),
 ('rawbark','SK','L90'):(35,721097),('rawbark','SK','P90'):(45,794141),('rawbark','SK','L12M'):(243,3520400),
 ('venev','CZ','L90'):(9,487),('venev','SK','L90'):(6,317),('venev','CZ','L12M'):(27,1382),('venev','SK','L12M'):(8,992),
}
spend = {
 ('dobias','US','L90'):29037,('dobias','US','P90'):17510,('dobias','CA','L90'):22326,('dobias','CA','P90'):2375,
 ('ethia','CZ','L90'):94386,('ethia','CZ','P90'):94801,('ethia','CZ','L12M'):565937,('ethia','CZ','P12M'):139738,
 ('manami','CZ','L90'):255961,('manami','CZ','P90'):230278,('manami','SK','L90'):29851,('manami','SK','P90'):24319,
 ('manami','CZ','L12M'):570836,('manami','SK','L12M'):115260,
 ('rawbark','CZ','L90'):577981,('rawbark','CZ','P90'):509757,('rawbark','SK','L90'):107006,('rawbark','SK','P90'):115174,
 ('rawbark','CZ','L12M'):1955451,('rawbark','SK','L12M'):396222,
 ('venev','CZ','L90'):3804,('venev','SK','L90'):139,('venev','CZ','L12M'):3804,('venev','SK','L12M'):139,
}
unalloc = {('manami','L12M'):36893,('rawbark','L12M'):287082,('venev','L12M'):2263}
for k,(new,rev) in q1.items():
    if k not in spend: continue
    s=spend[k]; c,m,p=k
    extra=''
    u=unalloc.get((c,p))
    if u:
        tot_new=sum(q1[(c,mm,p)][0] for mm in ('CZ','SK') if (c,mm,p) in q1)
        s2=s+u*new/tot_new
        extra=f' | incl unalloc pro-rata: spend {s2:,.0f} nCAC {s2/new:,.1f} MER {rev/s2:.2f}'
    print(f'{c:8}{m:3}{p:5} spend {s:>10,.0f} new {new:>5} nCAC {s/new:>8,.1f} MER {rev/s:6.2f}{extra}')
# cohort LTGP:CAC
print('--- cohort')
coh = { # client,market,hz: customers, gp_per_cust, spend_alloc
 ('ethia','CZ',90):(976,855.4,541823),('ethia','CZ',180):(1008,974.2,506436),('ethia','CZ',365):(369,1028.8,139738),
 ('manami','CZ',90):(1185,722.1,322039),('manami','SK',90):(317,618.5,104869),
 ('manami','CZ',180):(783,763.2,94736),('manami','SK',180):(262,629.7,80550),
}
cu={('manami',90):54646,('manami',180):72015}
for (c,m,h),(n,gp,s) in coh.items():
    u=cu.get((c,h),0)
    if u:
        tot=sum(coh[(c,mm,h)][0] for mm in ('CZ','SK'))
        s=s+u*n/tot
    cac=s/n
    print(f'{c} {m} {h}d customers {n} spend {s:,.0f} CAC {cac:,.1f} GP {gp} LTGP:CAC {gp/cac:.2f}')
# proxy: mature GP365 / L90 nCAC
print('--- proxy GP365 / L90 nCAC')
for c,m,gp in [('dobias','US',215.0),('dobias','CA',161.8),('manami','CZ',845.9),('manami','SK',675.6),('ethia','CZ',1028.8)]:
    new,rev=q1[(c,m,'L90')]; s=spend[(c,m,'L90')]
    print(c,m,round(gp/(s/new),2))
for c,m,gp in [('dobias','US',122.5),('dobias','CA',93.0),('venev','CZ',34.0)]:
    new,rev=q1[(c,m,'L90')]; s=spend[(c,m,'L90')]
    print('GP90',c,m,round(gp/(s/new),2))
