import json

def compare_songs(file1, file2):
  """
  Compares song names in two JSON files and extracts IDs for reference.

  Args:
      file1 (str): Path to the first JSON file.
      file2 (str): Path to the second JSON file.
  """
  # Load JSON files
  with open(file1, 'r', encoding='utf-8') as f1, open(file2, 'r', encoding='utf-8') as f2:
    data1 = json.load(f1)[:-1]  # Exclude last element (assuming "Date")
    data2 = json.load(f2)[:-1]

    songs_in_file1 = {song["Song"] for song in data1}
    songs_in_file2 = {song["Song"] for song in data2}



  # Find common songs
  common_songs = songs_in_file1.intersection(songs_in_file2)

  # Song names and IDs (dictionaries for easy lookup)
  if common_songs:
    print("Songs present in both files:")
    for song in common_songs:
      # Find matching song data
      matching_data1 = [data for data in data1 if data["Song"] == song]
      matching_data2 = [data for data in data2 if data["Song"] == song]

  missing_in_file2 = songs_in_file1.difference(songs_in_file2)

  # Print results
  if missing_in_file2:
    print("Songs present in file1 but missing in file2:")
    for song in missing_in_file2:
      # Find matching data in file 1
      matching_data = [data for data in data1 if data["Song"] == song]

      if matching_data:
        # Print data for the missing song
        # print('{')
        # print(f'  "Song": "{song}"')
        # for key in ("Chart", "Level", "Achv", "Rank", "Rating"):
        #   print(f'  , "{key}": "{matching_data[0][key]}"')
        # print('}')

        print(f'{matching_data[0]["Rank"]} | {matching_data[0]["Rating"]} | {song} | {matching_data[0]["Chart"]} | {matching_data[0]["Level"]} | {matching_data[0]["Achv"]}')
      else:
        print(f"  - Song: {song} (Data mismatch)")  # Handle potential mismatches

  else:
    print("All songs in file1 are also present in file2.")

# Replace with your filenames
compare_songs('ryan.json', 'marcus.json')
