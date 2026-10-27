# Demo: Točkica booking prototip

Pokreni lokalno iz mape `prototype/`:

```
python3 -m http.server 8000
```

Otvori `http://localhost:8000/schedule.html`. Sve je u memoriji preglednika, a stanje se dijeli
između stranica dok je tab otvoren. Gumb "Resetiraj demo" na admin stranici vraća početno stanje.

Početno stanje: dva test računa, svaki s 5 kredita. Test Klijent 1 nema Multisport oznaku,
Test Klijent 2 ima.

Napomena o datumu: treninzi su generirani za tekući tjedan i dva sljedeća. Korak 6 radi samo
ako je prvi ponedjeljak više od 6 sati u budućnosti.

---

## 1. Raspored

- **Stranica:** `schedule.html`
- **Radnja:** klikni prvi dan s treninzima u traci dana (ponedjeljak).
- **Očekivano:** tri treninga: 17:45 "Funky Spin", 18:45 "Rhythm Spin" i 19:45 "Fresh Start Spin". Kredit: 5.

## 2. Rezervacija bajka

- **Stranica:** `schedule.html`
- **Radnja:** klikni "rezerviraj" pri 17:45, pa bajk 3 i "Rezerviraj bajk 3".
- **Očekivano:** poruka "Rezervirano: bajk 3. Kredit: 4.", kredit 4.

## 3. Zauzet bajk

- **Stranica:** `schedule.html`
- **Radnja:** klikni "dodaj bajk" pri 17:45.
- **Očekivano:** bajk 3 je siv i ne može se kliknuti.

## 4. Popunjen trening i lista čekanja

- **Stranica:** `admin.html`, odjeljak "Demo alati"
- **Radnja:** u padajućem izborniku odaberi ponedjeljak 17:45 "Funky Spin", klikni "Napuni trening (sve bajkove)". Zatim se vrati na `schedule.html`.
- **Očekivano:** pri 17:45 umjesto "rezerviraj" piše "lista čekanja". Klik na njega daje poruku "Na listi čekanja. Dobit ćeš mail kad se mjesto oslobodi." s brojem poslanih mailova.
- **Napomena:** sadržaj mailova nije prikazan u prototipu, samo broj.

## 5. Kasno otkazivanje (unutar 6 sati)

- **Stranica:** `admin.html`, pa `schedule.html`
- **Radnja:** na adminu klikni "Dodaj trening za 20 min". Na rasporedu, za današnji dan, rezerviraj bajk 5 (odaberi, pa potvrdi) na "Demo: za 20 min", pa klikni "otkaži".
- **Očekivano:** poruka "Kasno otkazivanje: kredit se ne vraća.", kredit ostaje isti (3).

## 6. Otkazivanje više od 6 sati ranije

- **Stranica:** `schedule.html`
- **Radnja:** za prvi ponedjeljak, klikni "rezerviraj" pri 18:45, pa bajk 7 i "Rezerviraj bajk 7". Zatim klikni "otkaži" na kartici 18:45. Ne na kartici 17:45, gdje je tvoja rezervacija bajka 3 iz koraka 2.
- **Očekivano:** poruka "Otkazano. Kredit je vraćen.". Kredit: 3, pa 2 pri rezervaciji, pa 3 nakon otkazivanja.

## 7. Dolazak na recepciji

- **Stranica:** `schedule.html`, pa `reception.html`
- **Radnja:** na rasporedu rezerviraj bajk 6 (odaberi, pa potvrdi) na "Demo: za 20 min". Na recepciji je trening već odabran. Klikni "Dolazak" pri bajku 6.
- **Očekivano:** status "Došao". Ako check-in nije otvoren, piše kad se otvara.

## 8. Vraćanje kredita (vlasnica)

- **Stranica:** `admin.html`
- **Radnja:** kod Test Klijenta 1 unesi broj 1 i razlog "kašnjenje na mail", klikni "Vrati kredit".
- **Očekivano:** poruka "Spremljeno.", kredit povećan za 1.
- **Pravilo:** vraćanje je moguće samo za kredit koji je stvarno potrošen. Pokušaj vraćanja više nego što je potrošeno daje grešku.

## 9. Multisport oznaka i cijena

- **Stranica:** `admin.html`
- **Radnja:** kod Test Klijenta 1 uključi "Multisport". Kod paketa "1 trening" u polje Multisport upiši 9 i klikni "Spremi".
- **Očekivano:** poruka "Spremljeno.".
- **Napomena:** cijena se još ne vidi ni na jednom ekranu, jer kupnja paketa nije u prototipu. Pravilo cijene (Multisport cijena samo uz oznaku) provjereno je testom.

## 10. Reset

- **Stranica:** `admin.html`
- **Radnja:** klikni "Resetiraj demo".
- **Očekivano:** stranica se ponovo učita. Oba računa imaju 5 kredita, nema rezervacija ni demo treninga.

---

## Što demo još ne pokazuje

- Kupnju paketa i plaćanje (nije u prototipu).
- Sadržaj mailova (samo broj u poruci).
- Cijenu koja se mijenja s Multisport oznakom (samo postavka).
- Izvještaj instruktora, Sculpt Room i analitiku (faza 2).
- Dashboard, refer a friend i mobilnu aplikaciju (faza 3).
