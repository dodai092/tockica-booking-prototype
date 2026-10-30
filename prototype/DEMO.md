# Demo: Točkica booking prototip

Pokreni lokalno iz mape `prototype/`:

```
python3 -m http.server 8000
```

Otvori `http://localhost:8000/index.html`. Sve je u memoriji preglednika, a stanje se dijeli
između kartica dok je tab preglednika otvoren. Gumb "Resetiraj demo" na kartici Admin vraća početno stanje.

Prijava: gore je izbornik "Demo prijava". Klijent 1 i Klijent 2 vide samo Raspored i Profil, Recepcija vidi Raspored i Recepciju, Vlasnica vidi sve. Koraci s Adminom, Izvještajima i Recepcijom traže Vlasnicu (koraci 1 do 3, 6, 7, 12 i 13 rade i kao klijent). Trener Marko i Trener Iva vide samo Sculpt Room. Klijent ne vidi izbornik računa na Rasporedu, jer je prijavljen kao jedan račun.

Demo počinje u načinu "prosinac": nema kredita, plaća se u studiju. Rezervacija ne košta ništa, a kasno otkazivanje znači da se naplaćuje jedan trening (Dunia to primjenjuje ručno). Način se mijenja na Adminu, "Demo alati", gumb "Način". Korake s kreditima vidi na kraju, u odjeljku "Način Q1". Test Klijent 1 nema Multisport oznaku, Test Klijent 2 ima.

Napomena o datumu: treninzi su generirani za tekući tjedan i dva sljedeća. Korak 6 radi samo
ako je prvi ponedjeljak više od 6 sati u budućnosti.

---

## 1. Raspored

- **Kartica:** Raspored
- **Radnja:** klikni prvi dan s treninzima u traci dana (ponedjeljak).
- **Očekivano:** tri treninga: 17:45 "Funky Spin", 18:45 "Rhythm Spin" i 19:45 "Fresh Start Spin". Gore desno stoji gumb "Cjenik", nema broja kredita.

## 2. Rezervacija bicikla i potvrda

- **Kartica:** Raspored, pa Admin
- **Radnja:** klikni "rezerviraj" pri 17:45, pa bicikl 3 i "Rezerviraj 3". Zatim kao Vlasnica otvori Admin, "Poslani mailovi".
- **Očekivano:** poruka "Rezervirano: bicikl 3.", gumb ne spominje kredit. U mailovima je "Rezervirano: Funky Spin" s datumom, biciklom, rokom besplatnog otkazivanja i gumbom "Otkaži rezervaciju" (adresa nije u tekstu).

## 3. Zauzet bicikl

- **Kartica:** Raspored
- **Radnja:** klikni "dodaj bicikl" pri 17:45.
- **Očekivano:** bicikl 3 je siv i ne može se kliknuti.

## 4. Popunjen trening i lista čekanja

- **Kartica:** Admin, odjeljak "Demo alati"
- **Radnja:** u padajućem izborniku odaberi ponedjeljak 17:45 "Funky Spin", klikni "Napuni trening (sve bicikle)". Zatim se vrati na karticu Raspored.
- **Očekivano:** pri 17:45 umjesto "rezerviraj" piše "lista čekanja". Klik na njega daje poruku "Na listi čekanja. Dobit ćeš mail kad se mjesto oslobodi." Gumb tada piše "na listi", a ispod kartice je veza "napusti listu".

## 5. Kasno otkazivanje (unutar 6 sati)

- **Kartica:** Admin, pa Raspored
- **Radnja:** na adminu klikni "Dodaj trening za 20 min". Na rasporedu, za današnji dan, rezerviraj bicikl 5 na "Demo: za 20 min", pa klikni "otkaži".
- **Očekivano:** sheet kaže "Naplaćuje se jedan trening.", poruka "Kasno otkazivanje: naplaćuje se jedan trening." Mail "Otkazano" kaže isto. Rezervacija dobiva status "Kasno otkazano".

## 6. Otkazivanje više od 6 sati ranije

- **Kartica:** Raspored
- **Radnja:** za prvi ponedjeljak rezerviraj bicikl 7 na 18:45, pa klikni "otkaži" na toj kartici (ne na 17:45).
- **Očekivano:** poruka "Otkazano. Bez naplate." i mail "Otkazano na vrijeme, bez naplate.".
- **Napomena:** radi samo ako je prvi ponedjeljak više od 6 sati u budućnosti.

## 7. Prvi put vozim: izjava

- **Kartica:** Raspored (prijava Klijent 1)
- **Radnja:** klikni "rezerviraj" na bilo kojem treningu, odaberi bicikl, uključi "Prvi put vozim". Klikni "Potpisujem izjavu".
- **Očekivano:** dok izjava nije potpisana, gumb piše "Prvo potpiši izjavu" i ne radi. Nakon potpisa blok nestaje, a gumb je opet "Rezerviraj N". Prekidač više nije na ekranu za taj račun.
- **Napomena:** tekst izjave je privremen. Pravi tekst dolazi od Dunije ili njezina odvjetnika.

## 8. Gost i izjava gosta

- **Kartica:** Raspored, pa Recepcija
- **Radnja:** rezerviraj bicikl s uključenim "Za gosta" i imenom "Ana". Prijavi se kao Recepcija i otvori taj trening.
- **Očekivano:** u retku piše "Gost: Ana · bez izjave". U izborniku ⋯ je "Gost potpisao izjavu". Nakon klika piše "Gost: Ana · izjava potpisana".

## 9. Dolazak na recepciji

- **Kartica:** Raspored, pa Recepcija
- **Radnja:** na rasporedu rezerviraj bicikl 6 (odaberi, pa potvrdi) na "Demo: za 20 min". Na recepciji je trening već odabran. Klikni "Dolazak" pri biciklu 6. Zatim u retku "Prikaz" odaberi "Karta" i dodirni bicikl 6.
- **Očekivano:** status "Došao" (zeleni obrub, ne pun zeleni gumb). Ako check-in nije otvoren, piše kad se otvara. Na karti je bicikl 6 zelen, a ispod karte su ime, "Dolazak" i, kad trening krene, "No-show". Karta prati raspored u prostoriji (bicikli 1 do 10 desno, 11 do 20 lijevo, razmak nakon petog reda) i na svakom biciklu piše ime. Odabir Popis/Karta pamti se dok je tab otvoren.
- **Napomena:** u popisu je No-show (i ispravak nakon treninga) iza gumba ⋯ uz redak. Pretrage nema. Za puni trening: Admin, "Demo alati", "Napuni trening (sve bicikle)".

## 10. Premještanje klijenta na drugi bicikl

- **Kartica:** Recepcija
- **Radnja:** otvori izbornik ⋯ uz rezervaciju i klikni "Premjesti". Na karti klikni slobodan bicikl.
- **Očekivano:** karta nudi samo slobodne bicikle uz poruku i "Odustani". Nakon klika rezervacija ostaje ista, a bicikl je novi. Klijent dobiva mail "Novi bicikl na treningu". Radi i unutar 6 sati, jer to nije otkazivanje.

## 11. Podsjetnik 24 sata prije

- **Kartica:** Admin, pa Raspored
- **Radnja:** na adminu klikni "Dodaj trening za 20 min", rezerviraj bicikl na tom treningu kao Klijent 1. Kao Vlasnica klikni "Pošalji podsjetnike (24 h prije)" i to ponovi.
- **Očekivano:** u "Poslani mailovi" je jedan podsjetnik s datumom, biciklom i gumbom "Otkaži rezervaciju". Drugi klik ne šalje ništa. Više bicikala u istom treningu daje jedan mail. Gumb otvara Moj profil s pitanjem o otkazivanju (samo za vlasnika rezervacije, u istom tabu).

## 12. Cjenik

- **Kartica:** Raspored
- **Radnja:** klikni "Cjenik".
- **Očekivano:** popis paketa s cijenom i rokom valjanosti, bez gumba za kupnju i s napomenom "Plaćanje je u studiju, na licu mjesta.". Cijene su privremene.

## 13. Moj profil

- **Kartica:** Raspored, pa Profil
- **Radnja:** rezerviraj bicikl, otvori Profil, klikni "Otkaži" u tamnoj kartici i potvrdi.
- **Očekivano:** tamna kartica "Sljedeći trening" s biciklom i rokom besplatnog otkazivanja. Nema odjeljka "Krediti". Račun bez vožnji vidi "Za početak" s početnim paketima kao cijenom bez gumba "Kupi". U "Povijest" stoji "Otkazano · Bez naplate.".

## 14. Sculpt Room

- **Kartica:** Sculpt Room (prijava "Trener Marko"), pa Admin kao Vlasnica
- **Radnja:** kao Trener Marko odaberi sutrašnji dan i klikni "Rezerviraj" pri dva sata. Treći sat ne ide. Odaberi dan u sljedećem mjesecu. Klikni "Otkaži" na jednom satu. Zatim se prijavi kao Vlasnica, otvori Admin, odjeljak "Sculpt Room", klikni "Označi plaćeno" za Marka za sljedeći mjesec i "Makni" uz njegov sat (upiši razlog).
- **Očekivano:** poruka "Rezervirano: ...". Uz treći sat piše "Najviše 2 sata dnevno." Dan u sljedećem mjesecu piše "Studeni nije plaćen. Javi se vlasnici." (naziv mjeseca prema datumu). Sat koji drži Iva piše "Iva" i ne može se kliknuti. Nakon plaćanja sljedećeg mjeseca sati u njemu se mogu rezervirati. Uklonjeni sat nestaje iz kalendara, a u "Poslani mailovi" piše razlog.
- **Napomena:** najam vrijedi za kalendarski mjesec i evidentira datum, iznos (100 €) i napomenu. Marko je plaćen samo za tekući mjesec, pa Admin pri kraju mjeseca upozorava da treba označiti sljedeći. "Poništi" ne briše već rezervirane sate, samo blokira nove. Zatvoren dan (Admin, "Zatvoreni dani") blokira rezervacije, ali ne mijenja raspored treninga. Plaćanje i mailovi nisu stvarni.

## 15. Za naplatu

- **Kartica:** Raspored, pa Admin (samo u načinu "prosinac")
- **Radnja:** kao Klijent 1 rezerviraj "Demo: za 20 min" i otkaži. Kao Vlasnica otvori Admin, "Za naplatu".
- **Očekivano:** red "Kasno otkazano" s imenom i treningom. "Naplaćeno" ga miče s popisa. U načinu Q1 odjeljak nestaje.

## 16. Uredi trening

- **Kartica:** Admin, "Raspored"
- **Radnja:** u "Uredi trening" odaberi trening, promijeni ime, vrijeme, instruktora ili temu i klikni "Spremi".
- **Očekivano:** "Trening je uređen." Tko je imao rezervaciju dobiva jedan mail "Promjena treninga". Raspored se ne vraća na stari termin.

## 17. Zatvoreni dani i raspored

- **Kartica:** Admin, "Sculpt Room", "Zatvoreni dani"
- **Napomena:** zatvoren dan se više ne puni treninzima pri tjednom otvaranju. Treninzi koji su već napravljeni ostaju, otkaži ih ručno.

## 18. Preporuka i prekretnica

- **Kartica:** Profil, pa Admin
- **Radnja:** u Profilu upiši ime u "Preporučio/la te prijatelj?". Na Adminu se ime vidi uz račun. Gumb "Pošalji podsjetnike" šalje i mail vlasnici dan prije 50. ili 100. treninga klijenta.

## 19. Reset

- **Kartica:** Admin
- **Radnja:** klikni "Resetiraj demo".
- **Očekivano:** stranica se ponovo učita u načinu "prosinac". Nema rezervacija ni demo treninga.

---

## Način Q1 (krediti)

Na Adminu, "Demo alati", klikni gumb "Način" da se vrate krediti. Računi imaju po 5 kredita.

- **Rezervacija i otkazivanje:** gumb piše "Rezerviraj N · 1 kredit", poruka daje stanje kredita. Otkazivanje na vrijeme vraća kredit ("Kredit je vraćen."), kasno ne ("Kredit se ne vraća."). Gore desno su stanje kredita i "Kupi paket".
- **Vraćanje kredita (vlasnica):** na Adminu, kod Test Klijenta 1 unesi 1 i razlog, klikni "Vrati kredit". Moguće je samo za kredit koji je stvarno potrošen.
- **Multisport:** na Adminu uključi "Multisport" i upiši Multisport cijenu paketa "1 trening". Pravilo cijene provjereno je testom, a vidi se u prozoru "Kupi paket".
- **Moj profil:** odjeljak "Krediti" s rokovima i upozorenjem kad kredit ističe unutar 7 dana.

---

## Što demo još ne pokazuje

- Pravu prijavu (kod na mail) i pravo slanje mailova. Mailovi se samo spremaju i vide na Adminu.
- Plaćanje i kupnju paketa online (nije u prosincu).
- Izvještaj instruktora i analitiku (Q1).
- Zakazano slanje podsjetnika. Gumb na Adminu ga pokreće ručno.
- Blokadu prijave gosta bez potpisane izjave.
