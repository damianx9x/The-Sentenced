# The Sentenced Guild Hall 0.6.38-alpha

Dodatek dla klienta WoW Forever (interfejs 16001). Otwórz panel komendą `/ts`, a grę komendą `/tssnake`. `/tssnake auto` włącza lub wyłącza automatyczne otwarcie podczas dłuższego lotu.

W panelu i przy minimapie używany jest herb serwera The Sentenced. Pola i listy wyboru korzystają z kontrolek gry tam, gdzie klient je udostępnia. Funkcje DKP są wyłączone i nie znajdują się w paczce; wcześniejsze dane zapisane przez grę nie są usuwane.

**Gildia → Ludzie gildii** pokazuje również publiczne notatki z gry, np. wpisane tam profesje, bez wymogu instalacji dodatku przez daną osobę. Można szukać w notatkach, po nicku, klasie i randze oraz filtrować poziom (np. `40`, `40-50`, `>=55`). Pełna publiczna notatka jest w profilu. Notatki oficerskie nie są wykorzystywane.

**Ustawienia → Postać → Zapisz profesje w notatce gildii** wypełnia natywny edytor WoW pozycjami z głównych profesji postaci. Zatwierdzasz zmianę w grze. Jeśli profesje nie mieszczą się z dotychczasową notatką, addon ostrzega przed jej zastąpieniem. Otwórz **Profil → Profesje** na liście gildii, aby zobaczyć profesje i dostępne poziomy. Przycisk **Przepisy** prosi grę o natywną listę receptur wybranej osoby.

**Ustawienia → Postać → Moja oś łupów** zapisuje automatycznie własne łupy od zielonej jakości wzwyż. Historia przechowuje do 100 lokalnych wpisów tej postaci i odróżnia je od ręcznych zgłoszeń. Przełącznik **Dziennik łupów** zatrzymuje zbieranie nowych wpisów.

W zakładce **Postać** możesz wpisać główną postać z rosteru gildii i osobno włączyć udostępnianie tej deklaracji. To dobrowolna informacja od gracza, a nie weryfikacja właściciela konta. Usunięcie deklaracji wyłącza jej udostępnianie i próbuje wycofać kopię od osób online.

Zakładka **Gildia i ogłoszenia → Rzemiosło** wyszukuje profesje udostępniane przez roster gry oraz dobrowolne profile dodatku. Dane rosteru nie wymagają dodatku u innych osób i nie zawierają poziomu profesji; nie są zapisywane ani wysyłane. Dobrowolny profil może zawierać poziomy. Dane mogą być niepełne lub nieaktualne; dostępność i receptury wymagają potwierdzenia. Można otworzyć szept albo przygotować prośbę na tablicy; jej publikacja wymaga świadomego wysłania, a doręczenie nie jest gwarantowane.

Wyszukiwarka rozpoznaje polskie i angielskie nazwy popularnych profesji oraz polskie znaki, niezależnie od języka klienta gracza.

**Gildia i ogłoszenia → Zasoby** pozwala znaleźć przedmioty po nazwie lub ID w dobrowolnie udostępnionych migawkach noszonych toreb. Bank i poczta nie są uwzględnione; ilość i dostępność mogą się zmienić. Nazwy nieznane lokalnemu klientowi są pokazywane jako ID.

**Przed wyprawą** pozwala dobrowolnie zgłosić gotowość po zaznaczeniu wszystkich punktów. Do gildii wysyłany jest tylko status gotowości, a nie zawartość listy; wygasa po dwóch godzinach i można go wycofać. Odbiór przez innych graczy wymaga działania zgodnych wersji dodatku i nie jest gwarantowany. Widok wydarzeń potrafi otworzyć kalendarz gry i pokazać odczytane wpisy gildii, jeśli klient udostępnia te funkcje. Wpisy nie są kopiowane do planera dodatku.

Na skonfigurowanym Macu właściciela istniejący lokalny most może też pobierać z bota krótką listę nadchodzących raidów i otwartych wypraw. Raid z zamkniętymi zapisami pozostaje widoczny z odpowiednim oznaczeniem. Addon odczytuje dane po przeładowaniu interfejsu; to jednostronny odczyt, nie bieżąca synchronizacja ani parowanie innych graczy. Przestarzałe dane są oznaczane w widoku.

**Gildia i ogłoszenia → Discord** udostępnia ręczną synchronizację dla członków na dowolnym systemie. Na Discordzie wybierz `/bot → Addon → Połącz addon`, wpisz jednorazowy kod w grze i skopiuj wygenerowane żądanie do `/bot → Addon → Synchronizacja dodatku`. Odpowiedź z pliku bota wklej z powrotem w addon. W ten sposób odczytasz przyszłe raidy oraz przygotujesz zapis TAK/MOŻE/NIE. Zmiana następuje dopiero po przekazaniu żądania botowi; addon pokazuje wyłącznie potwierdzony stan. Zmiana lub zapełnienie raidu może wymagać ponownego odczytu. Nie jest to automatyczna synchronizacja ani test wszystkich systemów; weryfikowano klient Forever na Macu i logikę serwera.

Lokalny most właściciela pobiera także kolejkę nowych powitań po zaakceptowaniu zgłoszenia. Po `/reload` w zakładce Discord wybierz przygotowanie powitania, sprawdź tekst i naciśnij Enter. Addon zaznacza wysłanie dopiero po własnym echu na `/g`; kolejne zapisanie danych gry odsyła potwierdzenie na serwer. W tym kliencie automatyczny wysył z timera został zablokowany. Zwykłą wiadomość `/g` potwierdzono również na połączonym kanale Discord. Wiek kolejki jest ograniczony do 24 godzin; historyczne powitania nie są odtwarzane.

Snake inspirowany Snake II ma cztery trasy, w tym labirynty i przejście przez brzegi planszy. Co pięć artefaktów na chwilę pojawia się bonus: tarcza pochłania jedno zderzenie, zegar spowalnia grę, a moneta daje podwójne punkty. Kliknięcie **Trasa** rozpoczyna nową grę. Plansza ma własne tło, a rozgrywka zaczyna się po wyborze kierunku. Strzałki sterują grą bez poruszania postacią, inne klawisze pozostają dostępne. Pola tekstowe korzystają z szablonu `InputBoxTemplate` klienta, a w razie niedostępności z własnego pola zastępczego. W WoW Forever sprawdzono ekran startowy, roster, katalog profesji, otwarcie i walidację formularza wydarzenia oraz widok i sterowanie Snake. Wymiana danych między różnymi graczami w tej wersji wymaga dodatkowego testu. Wersja jest alfą.

Grafika `Textures/SnakeBoard.tga` została wygenerowana dla tej wersji dodatku. Czcionka w `Fonts/` ma osobną licencję w tym katalogu.

## Panel Kadra

GM i oficerowie gry znajdą osobną pozycję **Kadra** w lewym menu. Bot sprawdza aktualny dostęp do kanału kadry, zgodę na regulamin, Discord Screening i rewizję wniosku.

Na skonfigurowanym Macu właściciela synchronizator odświeża kolejkę co minutę. W grze dane wczytują się po **/reload**. Otwórz wniosek, wybierz decyzję i potwierdź **Przekaż decyzję**. Użyj **Zapisz i przeładuj** lub wyloguj się, by zapisać ją dla synchronizatora. Wynik będzie widoczny po następnym przeładowaniu, gdy synchronizator skończy pracę.

Na innych stanowiskach sparuj postać przez **/bot → Addon → Połącz addon**. Użyj **Pobierz wnioski**, przekaż żądanie przez **Synchronizacja dodatku** na Discordzie i wczytaj odpowiedź z załącznika. Po wybraniu decyzji przekaż osobne żądanie i wczytaj potwierdzenie. Dane wniosków nie są przesyłane kanałem gildii ani dołączane do ZIP-a.

W **Kadra → Napisz na Discordzie** wybierz kanał, wpisz tekst lub odnośnik, sprawdź nazwę kanału w podglądzie i potwierdź. Bot podpisze wiadomość jako **Kadra The Sentenced**. Bot i autor muszą mieć prawo pisania na docelowym kanale. Dołączenie pliku z dysku wymaga użycia klienta Discord.
